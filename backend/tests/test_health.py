from fastapi.testclient import TestClient


def test_healthcheck(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_healthcheck_head(client: TestClient) -> None:
    response = client.head("/health")

    assert response.status_code == 200
    assert response.text == ""
