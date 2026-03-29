"""Retry mechanism for extraction with configurable limits and exponential backoff."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Callable

from pydantic import ValidationError

from app.core.input_safety import sanitize_for_log

logger = logging.getLogger("gust.api")


@dataclass
class RetryConfig:
    """Configuration for retry behavior."""

    max_retries: int = 3
    base_delay: float = 1.0
    max_delay: float = 10.0
    exponential_base: float = 2.0


class ExtractionRetryManager:
    """Manages retry logic for extraction with validation and backoff."""

    def __init__(self, config: RetryConfig | None = None) -> None:
        self.config = config or RetryConfig()
        self.last_attempt_count = 0

    async def execute_with_retry(
        self,
        extraction_fn: Callable[..., Any],
        validator: Callable[[Any], Any],
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        """Execute extraction function with retry logic and validation.

        Args:
            extraction_fn: Async function to execute extraction.
            validator: Function to validate the extraction result.
            *args: Positional arguments for extraction_fn.
            **kwargs: Keyword arguments for extraction_fn.

        Returns:
            Validated extraction result.

        Raises:
            ExtractionRetryError: When max retries exceeded.
            ValidationError: When validation fails after all retries.
        """
        last_exception: Exception | None = None
        self.last_attempt_count = 0

        for attempt in range(1, self.config.max_retries + 1):
            try:
                # Execute extraction
                result = await extraction_fn(*args, **kwargs)

                # Validate result
                validated_result = validator(result)

                logger.info(
                    "extraction_retry_success",
                    extra={
                        "event": "extraction_retry_success",
                        "attempt": attempt,
                        "max_retries": self.config.max_retries,
                    },
                )

                self.last_attempt_count = attempt
                return validated_result

            except ValidationError as exc:
                last_exception = exc
                self.last_attempt_count = attempt
                logger.warning(
                    "extraction_validation_failed",
                    extra={
                        "event": "extraction_validation_failed",
                        "attempt": attempt,
                        "max_retries": self.config.max_retries,
                        "error_type": type(exc).__name__,
                        "validation_error_count": len(exc.errors()) if hasattr(exc, "errors") else 0,
                    },
                )

            except Exception as exc:
                last_exception = exc
                self.last_attempt_count = attempt
                error_details = {
                    "event": "extraction_attempt_failed",
                    "attempt": attempt,
                    "max_retries": self.config.max_retries,
                    "error_type": type(exc).__name__,
                    "error_message": sanitize_for_log(str(exc), max_length=160),
                }

                if hasattr(exc, "response"):
                    error_details["response_status"] = getattr(exc.response, "status_code", None)
                if hasattr(exc, "status_code"):
                    error_details["status_code"] = exc.status_code

                logger.warning("extraction_attempt_failed", extra=error_details)

            # Calculate delay with exponential backoff
            if attempt < self.config.max_retries:
                delay = self._calculate_delay(attempt)
                logger.info(
                    "extraction_retry_delay",
                    extra={
                        "event": "extraction_retry_delay",
                        "attempt": attempt,
                        "delay_seconds": delay,
                    },
                )
                await asyncio.sleep(delay)

        # All retries exhausted
        error_details = {
            "event": "extraction_retry_exhausted",
            "max_retries": self.config.max_retries,
            "last_error_type": type(last_exception).__name__ if last_exception else None,
            "last_error_message": sanitize_for_log(str(last_exception), max_length=160)
            if last_exception is not None
            else None,
        }

        if last_exception:
            if hasattr(last_exception, "response"):
                error_details["response_status"] = getattr(
                    last_exception.response, "status_code", None
                )
            if hasattr(last_exception, "status_code"):
                error_details["status_code"] = last_exception.status_code

        logger.error("extraction_retry_exhausted", extra=error_details)

        raise ExtractionRetryError(
            f"Extraction failed after {self.config.max_retries} attempts",
            last_exception=last_exception,
        )

    def _calculate_delay(self, attempt: int) -> float:
        """Calculate delay with exponential backoff.

        Args:
            attempt: Current attempt number (1-based).

        Returns:
            Delay in seconds.
        """
        delay = self.config.base_delay * (self.config.exponential_base ** (attempt - 1))
        return min(delay, self.config.max_delay)


class ExtractionRetryError(Exception):
    """Raised when extraction fails after all retry attempts."""

    def __init__(
        self,
        message: str,
        last_exception: Exception | None = None,
    ) -> None:
        super().__init__(message)
        self.last_exception = last_exception
