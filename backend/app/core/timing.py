from __future__ import annotations

import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass, field


@dataclass
class TimingSegment:
    name: str
    duration_ms: float


@dataclass
class RequestTimingRecorder:
    segments: list[TimingSegment] = field(default_factory=list)

    def record(self, name: str, duration_ms: float) -> None:
        self.segments.append(TimingSegment(name=name, duration_ms=duration_ms))

    def as_server_timing_header(self) -> str:
        return ", ".join(
            f"{segment.name};dur={segment.duration_ms:.2f}" for segment in self.segments
        )

    def as_log_payload(self) -> list[dict[str, float | str]]:
        return [
            {"name": segment.name, "duration_ms": round(segment.duration_ms, 2)}
            for segment in self.segments
        ]


_request_timing_var: ContextVar[RequestTimingRecorder | None] = ContextVar(
    "gust_request_timing",
    default=None,
)


def begin_request_timing() -> tuple[RequestTimingRecorder, Token[RequestTimingRecorder | None]]:
    recorder = RequestTimingRecorder()
    token = _request_timing_var.set(recorder)
    return recorder, token


def reset_request_timing(token: Token[RequestTimingRecorder | None]) -> None:
    _request_timing_var.reset(token)


def get_request_timing_recorder() -> RequestTimingRecorder | None:
    return _request_timing_var.get()


def record_timing(name: str, duration_ms: float) -> None:
    recorder = get_request_timing_recorder()
    if recorder is None:
        return
    recorder.record(name=name, duration_ms=duration_ms)


@contextmanager
def timed_stage(name: str) -> Iterator[None]:
    started_at = time.perf_counter()
    try:
        yield
    finally:
        record_timing(name=name, duration_ms=(time.perf_counter() - started_at) * 1000)
