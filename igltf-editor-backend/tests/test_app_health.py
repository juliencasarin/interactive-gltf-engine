from __future__ import annotations

from starlette.testclient import TestClient


def test_health_includes_mcp_path(igltf_app_client: TestClient):
    r = igltf_app_client.get("/health")
    assert r.status_code == 200
    payload = r.json()
    assert payload["status"] == "ok"
    assert payload["mcpPath"] == "/mcp"
    assert "engineVersion" in payload
