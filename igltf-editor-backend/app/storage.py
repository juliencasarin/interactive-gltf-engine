from __future__ import annotations

import os
import re
from pathlib import Path

_REGISTRY_ENV_KEYS = ("IGLTF_APP_DATA_DIR", "STORAGE_ROOT")

_UUID_HEX = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def get_registry_host_dir() -> Path:
    """ Writable app state dir: holds ``projects.json`` only (registry). """
    raw = ""
    for k in _REGISTRY_ENV_KEYS:
        raw = os.environ.get(k, "").strip()
        if raw:
            break
    if raw:
        p = Path(raw).resolve()
    else:
        p = (Path(__file__).resolve().parent.parent / "data").resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


def registry_projects_json_path() -> Path:
    return get_registry_host_dir() / "projects.json"


def get_storage_root() -> Path:
    """Backward-compatible name: same directory as registry host."""

    return get_registry_host_dir()


def get_public_base_url() -> str:
    return os.environ.get("PUBLIC_BASE_URL", "http://127.0.0.1:8000").rstrip("/")


def validate_project_route_id(project_id: str) -> None:
    if not project_id or ".." in project_id or "/" in project_id or "\\" in project_id:
        raise ValueError("invalid project id")


def resolve_project_root(project_id: str) -> Path:
    """
    Workspace root on disk for this API project id.
    Prefer registry ``diskPath``; otherwise legacy slug folder under registry host dir.
    """
    validate_project_route_id(project_id)

    # Lazy import: ``projects_registry`` imports paths from ``storage``.
    from app.projects_registry import get_by_id, load_registry

    reg = load_registry()
    hit = get_by_id(reg, project_id)
    if hit:
        p = Path(hit.diskPath).resolve()
        if not p.is_dir():
            raise ValueError("registered project workspace is missing from disk")
        return p

    if _UUID_HEX.fullmatch(project_id):
        raise ValueError("unknown project id")

    return get_registry_host_dir() / project_id


def project_dir(project_id: str) -> Path:
    return resolve_project_root(project_id)


def project_json_path(project_id: str) -> Path:
    return project_dir(project_id) / "project.json"


def assets_dir(project_id: str) -> Path:
    return project_dir(project_id) / "assets"


def staging_dir(project_id: str) -> Path:
    """Temporary uploads until PUT /document promotes them under assets/."""
    return project_dir(project_id) / "_staging"


def ensure_project_mcp_json(project_id: str) -> None:
    """Create project-root mcp.json if missing (never overwrite user's file)."""

    from app.mcp_project_config import write_project_mcp_json_if_absent

    write_project_mcp_json_if_absent(project_dir(project_id), get_public_base_url())


def ensure_project_cursor_rules(project_id: str) -> None:
    """Create .cursor/rules forbidding agent edits to project.json if missing."""

    from app.cursor_project_rules import write_project_cursor_rule_if_absent

    write_project_cursor_rule_if_absent(project_dir(project_id))


def ensure_project_mcp_best_practices(project_id: str) -> None:
    """Create root MCP best-practices Markdown for agents if missing."""

    from app.mcp_best_practices import write_mcp_best_practices_if_absent

    write_mcp_best_practices_if_absent(project_dir(project_id))


def ensure_project_identity_file(project_id: str) -> None:
    """Write `.igltf/project-id` in the workspace so MCP/IDE can resolve the hub UUID."""

    from app.project_identity import write_project_identity_file

    write_project_identity_file(project_dir(project_id), project_id)


def ensure_project_layout(project_id: str) -> None:
    d = project_dir(project_id)
    d.mkdir(parents=True, exist_ok=True)
    assets_dir(project_id).mkdir(parents=True, exist_ok=True)
    staging_dir(project_id).mkdir(parents=True, exist_ok=True)
    ensure_project_mcp_json(project_id)
    ensure_project_cursor_rules(project_id)
    ensure_project_mcp_best_practices(project_id)
    ensure_project_identity_file(project_id)


def file_mtime_version(disk: Path) -> str:
    """Nanosecond mtime for cache-busting play bundle URLs after rebuild."""
    try:
        return str(int(disk.stat().st_mtime_ns))
    except OSError:
        return "0"


def is_play_bundle_relative_path(relative_path: str) -> bool:
    """Built play artifacts and legacy root bundles should not be cached by clients."""
    norm = relative_path.lstrip("/").replace("\\", "/")
    return norm.startswith("build/") or norm in {"test.glb", "test.js"}


def file_url(project_id: str, relative_path: str, *, version: str | None = None) -> str:
    rel = relative_path.lstrip("/").replace("\\", "/")
    url = f"{get_public_base_url()}/files/{project_id}/{rel}"
    if version:
        url = f"{url}?v={version}"
    return url
