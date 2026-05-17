from __future__ import annotations

import json
from pathlib import Path

from app.mcp_project_config import (
    MCP_JSON_NAME,
    build_mcp_json_text,
    mcp_endpoint_url,
    write_project_mcp_json_if_absent,
)


def test_mcp_endpoint_composes_under_prefix():
    url = mcp_endpoint_url("http://127.0.0.1:8000")
    assert url == "http://127.0.0.1:8000/mcp"
    prefixed = mcp_endpoint_url("http://example.com/subpath")
    assert prefixed == "http://example.com/subpath/mcp"


def test_write_project_mcp_json_idempotent(tmp_path: Path):
    root = tmp_path / "proj"
    root.mkdir()
    wrote = write_project_mcp_json_if_absent(root, public_base_url="http://localhost:9123/")
    assert wrote is True
    p = root / MCP_JSON_NAME
    assert p.is_file()
    data = json.loads(p.read_text(encoding="utf-8"))
    assert (
        data["mcpServers"]["interactive-gltf-framework"]["url"]
        == "http://localhost:9123/mcp"
    )
    content = p.read_bytes()
    golden = json.loads(build_mcp_json_text("http://localhost:9123/"))
    assert golden == json.loads(content.decode())

    wrote_again = write_project_mcp_json_if_absent(root, public_base_url="http://other/")
    assert wrote_again is False
    assert p.read_bytes() == content
