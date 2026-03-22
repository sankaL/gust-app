from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date

import httpx

from app.core.errors import ConfigurationError
from app.core.settings import Settings


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
                    "schema": schema,
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
            raise ExtractorMalformedResponseError(
                "Extraction provider returned an invalid response."
            ) from exc

        if isinstance(content, str):
            try:
                parsed = json.loads(content)
            except json.JSONDecodeError as exc:
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
