"""Tests for workspace Cursor rule bootstrap."""

from __future__ import annotations

from app.cursor_project_rules import CURSOR_RULE_FILENAME, write_project_cursor_rule_if_absent
from app.storage import ensure_project_layout


def test_write_project_cursor_rule_if_absent(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("app.storage.project_dir", lambda _pid: tmp_path)
    assert write_project_cursor_rule_if_absent(tmp_path) is True
    rule_path = tmp_path / ".cursor" / "rules" / CURSOR_RULE_FILENAME
    assert rule_path.is_file()
    text = rule_path.read_text(encoding="utf-8")
    assert "never" in text.lower()
    assert "project.json" in text
    assert write_project_cursor_rule_if_absent(tmp_path) is False


def test_ensure_project_layout_writes_cursor_rule(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("app.storage.project_dir", lambda _pid: tmp_path)
    monkeypatch.setattr("app.storage.ensure_project_mcp_json", lambda _pid: None)
    ensure_project_layout("demo")
    assert (tmp_path / ".cursor" / "rules" / CURSOR_RULE_FILENAME).is_file()
