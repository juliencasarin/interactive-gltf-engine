from __future__ import annotations

import os
from pathlib import Path


def get_storage_root() -> Path:
    root = os.environ.get("STORAGE_ROOT", "").strip()
    if root:
        p = Path(root).resolve()
    else:
        p = (Path(__file__).resolve().parent.parent / "data").resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


def get_public_base_url() -> str:
    return os.environ.get("PUBLIC_BASE_URL", "http://127.0.0.1:8000").rstrip("/")


def project_dir(project_id: str) -> Path:
    if not project_id or ".." in project_id or "/" in project_id or "\\" in project_id:
        raise ValueError("invalid project id")
    return get_storage_root() / project_id


def project_json_path(project_id: str) -> Path:
    return project_dir(project_id) / "project.json"


def assets_dir(project_id: str) -> Path:
    return project_dir(project_id) / "assets"


def staging_dir(project_id: str) -> Path:
    """Temporary uploads until PUT /document promotes them under assets/."""
    return project_dir(project_id) / "_staging"


def ensure_project_layout(project_id: str) -> None:
    d = project_dir(project_id)
    d.mkdir(parents=True, exist_ok=True)
    assets_dir(project_id).mkdir(parents=True, exist_ok=True)
    staging_dir(project_id).mkdir(parents=True, exist_ok=True)


def file_url(project_id: str, relative_path: str) -> str:
    rel = relative_path.lstrip("/").replace("\\", "/")
    return f"{get_public_base_url()}/files/{project_id}/{rel}"
