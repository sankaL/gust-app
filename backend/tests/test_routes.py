from dataclasses import dataclass

from fastapi.testclient import TestClient

from app.core.dependencies import get_reminder_worker_service
from app.services.reminders import INTERNAL_JOB_SECRET_HEADER, ReminderRunSummary


@dataclass
class FakeReminderWorkerService:
    summary: ReminderRunSummary

    async def run_due_work(self) -> ReminderRunSummary:
        return self.summary


def test_internal_reminder_route_requires_shared_secret(client: TestClient) -> None:
    client.app.state.settings.internal_job_shared_secret = "phase4-secret"

    missing_response = client.post("/internal/reminders/run")
    invalid_response = client.post(
        "/internal/reminders/run",
        headers={INTERNAL_JOB_SECRET_HEADER: "wrong-secret"},
    )

    assert missing_response.status_code == 403
    assert invalid_response.status_code == 403


def test_internal_reminder_route_returns_summary_when_authorized(client: TestClient) -> None:
    client.app.state.settings.internal_job_shared_secret = "phase4-secret"
    client.app.dependency_overrides[get_reminder_worker_service] = lambda: FakeReminderWorkerService(
        summary=ReminderRunSummary(
            claimed=3,
            sent=2,
            cancelled=1,
            requeued=4,
            failed=0,
            captures_deleted=5,
        )
    )

    response = client.post(
        "/internal/reminders/run",
        headers={INTERNAL_JOB_SECRET_HEADER: "phase4-secret"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "claimed": 3,
        "sent": 2,
        "cancelled": 1,
        "requeued": 4,
        "failed": 0,
        "captures_deleted": 5,
    }


def test_tasks_and_groups_fail_closed_without_auth(client: TestClient) -> None:
    assert client.get("/tasks?group_id=missing").status_code == 401
    assert client.get("/groups").status_code == 401
