from __future__ import annotations

import copy
import json
import logging
import re
from dataclasses import dataclass
from datetime import date

import httpx

from app.core.errors import ConfigurationError
from app.core.settings import Settings

logger = logging.getLogger("gust.api")


@dataclass
class ExtractionRequest:
    transcript_text: str
    user_timezone: str
    current_local_date: date
    groups: list[dict[str, object]]


class ExtractionServiceError(Exception):
    pass


class ExtractorMalformedResponseError(ExtractionServiceError):
    pass


class OpenRouterExtractionService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def ensure_configured(self) -> None:
        if not self.settings.openrouter_api_key:
            raise ConfigurationError("OpenRouter extraction configuration is missing.")

    async def extract(
        self,
        *,
        request: ExtractionRequest,
        schema: dict[str, object],
    ) -> dict[str, object]:
        self.ensure_configured()

        timeout = httpx.Timeout(self.settings.extraction_timeout_seconds)
        headers = {
            "Authorization": f"Bearer {self.settings.openrouter_api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.settings.openrouter_extraction_model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You extract actionable tasks from Gust capture transcripts. "
                        "Return only JSON matching the provided schema. "
                        "Never invent new groups. Use Inbox when confidence is low."
                    ),
                },
                {
                    "role": "user",
                    "content": self._build_prompt(request),
                },
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "gust_capture_extraction",
                    "strict": True,
                    "schema": self._normalize_schema_for_strict_outputs(schema),
                },
            },
        }

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    self.settings.openrouter_api_url,
                    headers=headers,
                    json=payload,
                )
        except httpx.HTTPError as exc:
            raise ExtractionServiceError("Extraction provider request failed.") from exc

        if response.status_code >= 400:
            logger.warning(
                "extraction_provider_rejected",
                extra={
                    "event": "extraction_provider_rejected",
                    "provider_status_code": response.status_code,
                    "model": self.settings.openrouter_extraction_model,
                },
            )
            raise ExtractionServiceError("Extraction provider request failed.")

        try:
            body = response.json()
        except ValueError as exc:
            raise ExtractorMalformedResponseError(
                "Extraction provider returned invalid JSON."
            ) from exc
        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            logger.warning(
                "extraction_provider_payload_invalid",
                extra={
                    "event": "extraction_provider_payload_invalid",
                    "model": self.settings.openrouter_extraction_model,
                    "response_body_keys": sorted(body.keys()) if isinstance(body, dict) else [],
                },
            )
            raise ExtractorMalformedResponseError(
                "Extraction provider returned an invalid response."
            ) from exc

        if isinstance(content, str):
            try:
                parsed = json.loads(self._strip_json_fence(content))
            except json.JSONDecodeError as exc:
                logger.warning(
                    "extraction_provider_content_invalid",
                    extra={
                        "event": "extraction_provider_content_invalid",
                        "model": self.settings.openrouter_extraction_model,
                        "content_length": len(content),
                        "content_is_fenced_json": bool(re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", content.strip(), flags=re.DOTALL)),
                    },
                )
                raise ExtractorMalformedResponseError(
                    "Extraction provider returned invalid JSON."
                ) from exc
        elif isinstance(content, dict):
            parsed = content
        else:
            raise ExtractorMalformedResponseError(
                "Extraction provider returned an unsupported payload."
            )

        if not isinstance(parsed, dict):
            raise ExtractorMalformedResponseError(
                "Extraction provider returned a non-object payload."
            )

        return parsed

    def _build_prompt(self, request: ExtractionRequest) -> str:
        group_lines: list[str] = []
        for group in request.groups:
            recent = group.get("recent_task_titles") or []
            recent_titles = ", ".join(str(item) for item in recent) if recent else "None"
            description = group.get("description") or "None"
            group_lines.append(
                f"- {group['name']} (id={group['id']}, description={description}, "
                f"recent={recent_titles})"
            )

        return "\n".join(
            [
                f"User timezone: {request.user_timezone}",
                f"Current local date: {request.current_local_date.isoformat()}",
                "Available groups:",
                "\n".join(group_lines) or "- Inbox",
                "Transcript:",
                request.transcript_text,
            ]
        )

    def _strip_json_fence(self, content: str) -> str:
        stripped = content.strip()
        match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", stripped, flags=re.DOTALL)
        if match is not None:
            return match.group(1).strip()
        return stripped

    def _normalize_schema_for_strict_outputs(self, schema: dict[str, object]) -> dict[str, object]:
        normalized = copy.deepcopy(schema)
        self._normalize_schema_node(normalized)
        return normalized

    def _normalize_schema_node(self, node: object) -> None:
        if isinstance(node, list):
            for item in node:
                self._normalize_schema_node(item)
            return

        if not isinstance(node, dict):
            return

        node.pop("default", None)

        for value in node.values():
            self._normalize_schema_node(value)

        properties = node.get("properties")
        if node.get("type") == "object" and isinstance(properties, dict):
            node["required"] = list(properties.keys())
