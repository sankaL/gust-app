from __future__ import annotations

import json
import logging
from typing import Any


class JsonExtraFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Include all extra fields from the record
        # This captures any additional fields passed via the 'extra' parameter
        for key, value in record.__dict__.items():
            # Skip standard LogRecord attributes and private attributes
            if key.startswith("_") or key in (
                "name",
                "msg",
                "args",
                "levelname",
                "levelno",
                "pathname",
                "filename",
                "module",
                "exc_info",
                "exc_text",
                "stack_info",
                "lineno",
                "funcName",
                "created",
                "msecs",
                "relativeCreated",
                "thread",
                "threadName",
                "processName",
                "process",
                "message",
            ):
                continue
            # Include the extra field if it's not None
            if value is not None:
                payload[key] = value

        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)

        return json.dumps(payload, sort_keys=True)


def configure_logging(level: str) -> None:
    root_logger = logging.getLogger()
    root_logger.handlers.clear()

    handler = logging.StreamHandler()
    handler.setFormatter(JsonExtraFormatter())

    root_logger.addHandler(handler)
    root_logger.setLevel(level.upper())

    # Suppress LangChain debug/info logging to prevent transcript content leakage
    for logger_name in (
        "langchain",
        "langchain_core",
        "langchain_openai",
        "openai",
        "httpx",
        "httpcore",
    ):
        logging.getLogger(logger_name).setLevel(logging.WARNING)
