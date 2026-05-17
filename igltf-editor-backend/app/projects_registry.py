from __future__ import annotations

import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator

from app.storage import registry_projects_json_path


def _utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class RegisteredProject(BaseModel):
    """One row in projects.json."""

    id: str
    diskPath: str
    lastSavedAt: str | None = None
    savedWithEngineVersion: str | None = None


class ProjectsRegistryFile(BaseModel):
    version: int = 1
    projects: list[RegisteredProject] = Field(default_factory=list)

    model_config = {"extra": "ignore"}

    @field_validator("version")
    @classmethod
    def _v(cls, v: int) -> int:
        if v != 1:
            raise ValueError("only registry schema version 1 supported")
        return v


def load_registry() -> ProjectsRegistryFile:
    path = registry_projects_json_path()
    if not path.is_file():
        return ProjectsRegistryFile(version=1, projects=[])
    raw = json.loads(path.read_text(encoding="utf-8"))
    return ProjectsRegistryFile.model_validate(raw)


def save_registry(reg: ProjectsRegistryFile) -> None:
    path = registry_projects_json_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(reg.model_dump(mode="json"), ensure_ascii=False, indent=2)
    fd, tmp_name = tempfile.mkstemp(
        prefix="projects-",
        suffix=".json",
        dir=str(path.parent),
    )
    try:
        with open(fd, "w", encoding="utf-8", closefd=True) as f:
            f.write(text)
            f.flush()
        Path(tmp_name).replace(path)
    finally:
        t = Path(tmp_name)
        if t.is_file() and t.resolve() != path.resolve():
            t.unlink(missing_ok=True)


def get_by_id(reg: ProjectsRegistryFile, project_id: str) -> RegisteredProject | None:
    return next((p for p in reg.projects if p.id == project_id), None)


def get_by_disk_path(reg: ProjectsRegistryFile, resolved: Path) -> RegisteredProject | None:
    target = resolved.resolve()
    return next((p for p in reg.projects if Path(p.diskPath).resolve() == target), None)


def add_registered_project_at_disk(disk_path: Path) -> str:
    wd = disk_path.resolve()
    if not wd.is_dir():
        raise ValueError("project path must be an existing directory")
    reg = load_registry()
    clash = get_by_disk_path(reg, wd)
    if clash is not None:
        raise ValueError("project directory already registered")
    pid = str(uuid4())
    reg.projects.append(RegisteredProject(id=pid, diskPath=str(wd)))
    save_registry(reg)
    return pid


def get_or_register_directory(disk_path: Path) -> str:
    """Return existing id if path already registered; else register and return new id."""
    wd = disk_path.resolve()
    if not wd.is_dir():
        raise ValueError("project path must be an existing directory")
    reg = load_registry()
    existing = get_by_disk_path(reg, wd)
    if existing:
        return existing.id
    return add_registered_project_at_disk(wd)


def touch_saved_metadata(project_id: str, *, engine_version: str) -> None:
    reg = load_registry()
    p = get_by_id(reg, project_id)
    if p is None:
        return
    p.lastSavedAt = _utc_iso()
    p.savedWithEngineVersion = engine_version
    save_registry(reg)


def delete_project_registration(project_id: str) -> bool:
    reg = load_registry()
    keep = [p for p in reg.projects if p.id != project_id]
    if len(keep) == len(reg.projects):
        return False
    reg.projects = keep
    save_registry(reg)
    return True


def list_registered_public() -> list[dict]:
    """JSON-serializable list for GET /studio/projects."""

    reg = load_registry()
    out: list[dict] = []
    for p in reg.projects:
        disk = Path(p.diskPath)
        out.append(
            {
                "id": p.id,
                "diskPath": p.diskPath,
                "displayName": disk.name,
                "lastSavedAt": p.lastSavedAt,
                "savedWithEngineVersion": p.savedWithEngineVersion,
            },
        )
    return out
