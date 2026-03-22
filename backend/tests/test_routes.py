from fastapi.testclient import TestClient


def test_remaining_placeholder_routes_are_mounted(client: TestClient) -> None:
    routes = [
        ("POST", "/captures"),
        ("GET", "/tasks"),
        ("GET", "/groups"),
        ("POST", "/internal/reminders/run"),
    ]

    for method, path in routes:
        response = client.request(method, path)
        assert response.status_code == 501
