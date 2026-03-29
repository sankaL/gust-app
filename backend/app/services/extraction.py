"""Extraction service using LangChain with OpenRouter for task extraction."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import date
from typing import Any

from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableLambda
from langchain_openai import ChatOpenAI

from app.core.errors import ConfigurationError
from app.core.input_safety import sanitize_for_log
from app.core.settings import Settings
from app.prompts.extraction_prompts import ExtractionPromptManager
from app.services.extraction_models import (
    ExtractionModelConfig,
    ExtractionModelRegistry,
    ExtractorPayload,
)
from app.services.extraction_retry import ExtractionRetryError, ExtractionRetryManager, RetryConfig

logger = logging.getLogger("gust.api")


@dataclass
class ExtractionRequest:
    """Request for task extraction."""

    transcript_text: str
    user_timezone: str
    current_local_date: date
    groups: list[dict[str, object]]
    missing_guarded_clauses: list[str] | None = None


class ExtractionServiceError(Exception):
    """Base exception for extraction service errors."""

    pass


class ExtractorMalformedResponseError(ExtractionServiceError):
    """Raised when extraction provider returns malformed response."""

    pass


class LangChainExtractionService:
    """Extraction service using LangChain with OpenRouter."""

    def __init__(
        self,
        settings: Settings,
        prompt_manager: ExtractionPromptManager | None = None,
        retry_manager: ExtractionRetryManager | None = None,
        model_registry: ExtractionModelRegistry | None = None,
    ) -> None:
        self.settings = settings
        self.prompt_manager = prompt_manager or ExtractionPromptManager()
        self.retry_manager = retry_manager or self._create_retry_manager()
        self.model_registry = model_registry or self._create_model_registry()
        self.output_parser = JsonOutputParser()
        self.last_attempt_count = 0

    def _create_retry_manager(self) -> ExtractionRetryManager:
        """Create retry manager from settings."""
        config = RetryConfig(
            max_retries=self.settings.extraction_max_retries,
            base_delay=self.settings.extraction_retry_base_delay,
            max_delay=self.settings.extraction_retry_max_delay,
        )
        return ExtractionRetryManager(config=config)

    def _create_model_registry(self) -> ExtractionModelRegistry:
        """Create model registry from settings."""
        if self.settings.extraction_model_config_path:
            return ExtractionModelRegistry.from_yaml(
                self.settings.extraction_model_config_path,
                ab_test_enabled=self.settings.extraction_ab_test_enabled,
            )
        return ExtractionModelRegistry.default(
            self.settings.openrouter_extraction_model,
            ab_test_enabled=self.settings.extraction_ab_test_enabled,
        )

    def ensure_configured(self) -> None:
        """Ensure extraction service is properly configured."""
        if not self.settings.openrouter_api_key:
            raise ConfigurationError("OpenRouter extraction configuration is missing.")

    async def extract(
        self,
        *,
        request: ExtractionRequest,
    ) -> dict[str, object]:
        """Extract tasks from transcript using LangChain with retry logic.

        Args:
            request: Extraction request with transcript and context.

        Returns:
            Validated extraction payload as dictionary.

        Raises:
            ExtractionServiceError: When extraction fails.
            ExtractorMalformedResponseError: When response is malformed.
        """
        self.last_attempt_count = 0
        self.ensure_configured()

        # Select model for this extraction
        model_config = self.model_registry.select_model()

        # Create LLM once for all retry attempts
        llm = self._create_llm(model_config)

        logger.info(
            "extraction_started",
            extra={
                "event": "extraction_started",
                "model": model_config.model_id,
                "model_name": model_config.name,
                "transcript_length": len(request.transcript_text),
            },
        )

        try:
            # Execute extraction with retry logic
            result = await self.retry_manager.execute_with_retry(
                self._execute_extraction,
                self._validate_result,
                request=request,
                model_config=model_config,
                llm=llm,
            )
            self.last_attempt_count = self.retry_manager.last_attempt_count

            logger.info(
                "extraction_completed",
                extra={
                    "event": "extraction_completed",
                    "model": model_config.model_id,
                    "model_name": model_config.name,
                    "attempt_count": self.last_attempt_count,
                    "tasks_extracted": len(result.get("tasks", [])),
                },
            )

            return result

        except ExtractionRetryError as exc:
            self.last_attempt_count = self.retry_manager.last_attempt_count
            logger.error(
                "extraction_failed",
                extra={
                    "event": "extraction_failed",
                    "model": model_config.model_id,
                    "model_name": model_config.name,
                    "attempt_count": self.last_attempt_count,
                    "error_type": type(exc).__name__,
                    "last_error_type": (
                        type(exc.last_exception).__name__ if exc.last_exception else None
                    ),
                },
            )
            raise ExtractionServiceError("Extraction failed after retries.") from exc

    async def _execute_extraction(
        self,
        request: ExtractionRequest,
        model_config: ExtractionModelConfig,
        llm: ChatOpenAI,
    ) -> dict[str, object]:
        """Execute a single extraction attempt.

        Args:
            request: Extraction request.
            model_config: Model configuration to use.
            llm: Pre-configured LangChain LLM instance.

        Returns:
            Raw extraction result.

        Raises:
            ExtractorMalformedResponseError: When response is malformed.
        """
        # Build prompts
        system_prompt = self.prompt_manager.get_system_prompt()
        user_prompt = self.prompt_manager.get_user_prompt(
            user_timezone=request.user_timezone,
            current_local_date=request.current_local_date,
            groups=request.groups,
            transcript_text=request.transcript_text,
            missing_guarded_clauses=request.missing_guarded_clauses,
        )

        # Create prompt template
        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", "{system_prompt}"),
                ("user", "{user_input}"),
            ]
        )

        # Create chain - use a custom parser to extract JSON from mixed text output
        def extract_json_from_text(input_: Any) -> dict:
            """Extract JSON from the model's mixed-text response.

            Strategy (in priority order):
            1. Find the 'PASS 2 OUTPUT:' label and extract the JSON that follows it.
               This is the most reliable anchor since the prompt explicitly uses this label.
            2. If no label is found, fall back to the last top-level JSON object in the text
               (greedy match, rightmost wins).
            3. Strip any code fence (```json ... ```) before parsing in all cases.
            """
            import re

            # ── 1. Normalise input to a plain string ──────────────────────────────
            if hasattr(input_, "content"):
                content = input_.content
                if isinstance(content, list):
                    text = ""
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "text":
                            text = block.get("text", "")
                            break
                        elif isinstance(block, str):
                            text = block
                            break
                else:
                    text = str(content)
            else:
                text = str(input_)

            # ── 2. Helper: strip a single code fence wrapper ──────────────────────
            def _strip_fence(s: str) -> str:
                m = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", s.strip(), flags=re.DOTALL)
                return m.group(1).strip() if m else s.strip()

            # ── 3. Try to isolate the PASS 2 OUTPUT section first ─────────────────
            # The prompt instructs the model to label its final JSON with "PASS 2 OUTPUT:"
            # Be flexible with variations: "PASS TWO", "Pass 2 Output:", etc.
            pass2_patterns = [
                r"PASS\s*2\s*OUTPUT\s*:(.*)",  # PASS 2 OUTPUT:
                r"PASS\s*TWO\s*OUTPUT\s*:(.*)",  # PASS TWO OUTPUT:
                r"PASS\s*2\s*OUTPUT\s*\n+(.*)",  # PASS 2 OUTPUT with newlines
                r"```json\s*\n(.*?)\n```",  # JSON in code block without PASS marker
                r"```\s*\n(.*?)\n```",  # Any code block
            ]

            fragment = text  # Default to full text
            for pattern in pass2_patterns:
                pass2_match = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
                if pass2_match:
                    candidate = pass2_match.group(1).strip()
                    # Verify this candidate actually looks like JSON (starts with {)
                    if candidate.strip().startswith("{"):
                        fragment = candidate
                        break

            # Strip a code fence that may wrap the whole fragment
            fragment = _strip_fence(fragment)

            # ── 4. Greedy match: outermost { … } in the fragment ──────────────────
            # re.findall with a greedy pattern returns one match spanning
            # the first '{' to the last '}', which is exactly the tasks object.
            json_match = re.search(r"\{[\s\S]*\}", fragment)
            if json_match:
                return json.loads(json_match.group(0))

            # ── 5. Last resort: parse fragment directly ───────────────────────────
            return json.loads(fragment)

        chain = prompt | llm | RunnableLambda(extract_json_from_text)

        # Execute chain
        try:
            result = await chain.ainvoke(
                {
                    "system_prompt": system_prompt,
                    "user_input": user_prompt,
                }
            )
        except Exception as exc:
            error_details = {
                "event": "extraction_chain_error",
                "model": model_config.model_id,
                "model_name": model_config.name,
                "error_type": type(exc).__name__,
                "error_message": sanitize_for_log(str(exc), max_length=160),
            }

            if hasattr(exc, "response"):
                error_details["response_status"] = getattr(exc.response, "status_code", None)
            if hasattr(exc, "status_code"):
                error_details["status_code"] = exc.status_code

            logger.warning("extraction_chain_error", extra=error_details)
            raise ExtractorMalformedResponseError(
                f"Extraction provider request failed: {type(exc).__name__}: {str(exc)}"
            ) from exc

        # Parse and normalize result
        return self._parse_result(result)

    def _create_llm(self, model_config: ExtractionModelConfig) -> ChatOpenAI:
        """Create LangChain LLM instance.

        Args:
            model_config: Model configuration.

        Returns:
            Configured ChatOpenAI instance.
        """
        # Extract base URL from OpenRouter API URL
        base_url = self.settings.openrouter_api_url.replace("/chat/completions", "")

        # Log API configuration for debugging
        logger.debug(
            "extraction_llm_config",
            extra={
                "event": "extraction_llm_config",
                "model_id": model_config.model_id,
                "model_name": model_config.name,
                "base_url": base_url,
                "api_key_configured": bool(self.settings.openrouter_api_key),
                "temperature": model_config.temperature,
                "max_tokens": model_config.max_tokens,
                "timeout_seconds": self.settings.extraction_timeout_seconds,
            },
        )

        return ChatOpenAI(
            model=model_config.model_id,
            openai_api_key=self.settings.openrouter_api_key,
            openai_api_base=base_url,
            temperature=model_config.temperature,
            max_tokens=model_config.max_tokens,
            timeout=self.settings.extraction_timeout_seconds,
            max_retries=0,  # We handle retries ourselves
        )

    def _parse_result(self, result: Any) -> dict[str, object]:
        """Parse and normalize extraction result.

        Args:
            result: Raw result from LLM.

        Returns:
            Normalized dictionary result.

        Raises:
            ExtractorMalformedResponseError: When result cannot be parsed.
        """
        # Log the raw response for debugging
        logger.debug(
            "extraction_raw_response",
            extra={
                "event": "extraction_raw_response",
                "result_type": type(result).__name__,
                "result_size_chars": len(str(result)) if result is not None else 0,
            },
        )

        if isinstance(result, dict):
            return result

        if isinstance(result, str):
            try:
                parsed = json.loads(self._strip_json_fence(result))
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError as exc:
                logger.warning(
                    "extraction_parse_error",
                    extra={
                        "event": "extraction_parse_error",
                        "content_length": len(result),
                        "error_type": type(exc).__name__,
                    },
                )
                raise ExtractorMalformedResponseError(
                    "Extraction provider returned invalid JSON."
                ) from exc

        raise ExtractorMalformedResponseError(
            "Extraction provider returned an unsupported payload."
        )

    def _validate_result(self, result: dict[str, object]) -> dict[str, object]:
        """Validate extraction result against Pydantic schema.

        Args:
            result: Raw extraction result.

        Returns:
            Validated result as dictionary.

        Raises:
            ValidationError: When validation fails.
        """
        # Validate using Pydantic model
        validated = ExtractorPayload.model_validate(result)
        return validated.model_dump()

    def _strip_json_fence(self, content: str) -> str:
        """Strip JSON fence markers from content.

        Args:
            content: Content that may contain JSON fence.

        Returns:
            Content without fence markers.
        """
        stripped = content.strip()
        match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", stripped, flags=re.DOTALL)
        if match is not None:
            return match.group(1).strip()
        return stripped


# Keep backward compatibility
OpenRouterExtractionService = LangChainExtractionService
