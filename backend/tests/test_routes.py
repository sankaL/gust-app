from fastapi.testclient import TestClient


def test_internal_reminder_placeholder_route_is_still_mounted(client: TestClient) -> None:
    response = client.post("/internal/reminders/run")

    assert response.status_code == 501


def test_tasks_and_groups_fail_closed_without_auth(client: TestClient) -> None:
    assert client.get("/tasks?group_id=missing").status_code == 401
    assert client.get("/groups").status_code == 401
