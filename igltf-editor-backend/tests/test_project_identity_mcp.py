"""Tests for workspace project-id file + MCP resolve helpers."""

from __future__ import annotations

from app.mcp_scene_tools import igltf_list_registered_projects, igltf_resolve_project_id
from app.project_identity import read_project_identity_file, write_project_identity_file
from app.projects_registry import add_registered_project_at_disk, load_registry


def test_project_identity_roundtrip(tmp_path) -> None:
    write_project_identity_file(tmp_path, "abc-123")
    assert read_project_identity_file(tmp_path) == "abc-123"
    assert (tmp_path / ".igltf" / "project-id").is_file()


def test_resolve_project_id_from_workspace_file(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("app.projects_registry.registry_projects_json_path", lambda: tmp_path / "registry.json")
    ws = tmp_path / "ws"
    ws.mkdir()
    pid = add_registered_project_at_disk(ws)
    write_project_identity_file(ws, pid)

    out = igltf_resolve_project_id(disk_path=str(tmp_path / "ws"))
    assert out["projectId"] == pid
    assert out["source"] == "workspace_file"


def test_list_registered_projects_includes_session_fields(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("app.projects_registry.registry_projects_json_path", lambda: tmp_path / "registry.json")
    ws = tmp_path / "ws"
    ws.mkdir()
    pid = add_registered_project_at_disk(ws)

    rows = igltf_list_registered_projects()["projects"]
    assert len(rows) == 1
    assert rows[0]["id"] == pid
    assert rows[0]["displayName"] == "ws"
    assert rows[0]["canReadLiveSession"] is False

    # cleanup registry module cache not needed - fresh tmp registry each test
    assert load_registry().projects[0].id == pid
