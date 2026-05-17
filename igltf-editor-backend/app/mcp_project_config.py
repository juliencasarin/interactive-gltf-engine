from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from app.storage import get_public_base_url


MCP_MOUNT_PATH = "/mcp"
MCP_JSON_NAME = "mcp.json"


def mcp_endpoint_url(public_base_url: str | None = None) -> str:
    base = (public_base_url or get_public_base_url()).rstrip("/")
    parsed = urlsplit(base)
    if parsed.scheme not in ("http", "https"):
        base = get_public_base_url().rstrip("/")
        parsed = urlsplit(base)
    path = (parsed.path or "").rstrip("/") + MCP_MOUNT_PATH
    return urlunsplit((parsed.scheme, parsed.netloc, path or MCP_MOUNT_PATH, "", ""))


def build_mcp_json_text(public_base_url: str | None = None) -> str:
    endpoint = mcp_endpoint_url(public_base_url)
    data = {
        "mcpServers": {
            "interactive-gltf-framework": {
                "url": endpoint,
                "description": "Interactive glTF script authoring docs (listing + read of authoring_kit). Hosted by igltf-editor-backend; start backend before attaching in Cursor/Kilocode.",
            },
        },
        "_generatedBy": "igltf-editor-backend",
    }
    return json.dumps(data, indent=2) + "\n"


def write_project_mcp_json_if_absent(project_root: Path, public_base_url: str | None = None) -> bool:
    target = Path(project_root) / MCP_JSON_NAME
    if target.is_file():
        return False
    target.write_text(build_mcp_json_text(public_base_url), encoding="utf-8")
    return True
