"""On-disk project id hint for MCP / IDE (UUID from hub registry)."""

from __future__ import annotations

from pathlib import Path

IGLTF_META_DIR = ".igltf"
PROJECT_ID_FILENAME = "project-id"


def project_identity_path(project_root: Path) -> Path:
    return Path(project_root) / IGLTF_META_DIR / PROJECT_ID_FILENAME


def write_project_identity_file(project_root: Path, project_id: str) -> None:
    pid = project_id.strip()
    if not pid:
        return
    target = project_identity_path(project_root)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and target.read_text(encoding="utf-8").strip() == pid:
        return
    target.write_text(pid + "\n", encoding="utf-8")


def read_project_identity_file(project_root: Path) -> str | None:
    target = project_identity_path(project_root)
    if not target.is_file():
        return None
    text = target.read_text(encoding="utf-8").strip()
    return text or None
