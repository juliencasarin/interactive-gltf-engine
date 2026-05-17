from __future__ import annotations

import logging

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.server import StreamableHTTPASGIApp

from app.authoring_kit_fs import list_framework_kit_files_rel, read_framework_kit_file, resolve_authoring_kit_root
from app.version_info import ENGINE_VERSION

logger = logging.getLogger(__name__)

"""Single Fast MCP instance bundled with igltf-editor-backend."""
framework_fast_mcp = FastMCP(
    name="interactive-gltf-framework",
    instructions=(
        "Interactive glTF authoring: browse and read authoring_kit Markdown and JavaScript that define "
        "interaction script patterns (`GLTF`, transactions, exported classes extending EventInteraction-like bases). "
        f"Backend engineVersion is {ENGINE_VERSION!r}; correlate with REST GET /health."
    ),
    streamable_http_path="/",
    stateless_http=True,
)

_streamable_mount_handler: StreamableHTTPASGIApp | None = None


@framework_fast_mcp.tool(name="igltf_list_framework_files")
def igltf_list_framework_files() -> dict[str, object]:
    """Relative paths (.md/.js/.txt) under authoring_kit bundled with igltf-editor-backend (for MCP clients)."""

    root = resolve_authoring_kit_root()
    paths = list_framework_kit_files_rel(root)
    return {
        "engineVersion": ENGINE_VERSION,
        "authoring_kit_root": root.as_posix(),
        "files": paths,
    }


@framework_fast_mcp.tool(name="igltf_read_framework_file")
def igltf_read_framework_file(rel_path: str) -> dict[str, object]:
    """
    UTF-8 text of one authoring_kit file. rel_path uses forward slashes, no traversal.
    See igltf_list_framework_files before reading.
    """

    root = resolve_authoring_kit_root()
    body, nbytes = read_framework_kit_file(rel_path, root)
    return {
        "engineVersion": ENGINE_VERSION,
        "rel_path": rel_path.replace("\\", "/").lstrip("/"),
        "byteLength": nbytes,
        "contents": body,
    }


def prime_mcp_mount_handler() -> StreamableHTTPASGIApp:
    """Initialise FastMCP streamable-http session manager; build ASGI callable for mounting at PUBLIC_BASE_URL + /mcp."""

    global _streamable_mount_handler
    if _streamable_mount_handler is not None:
        return _streamable_mount_handler

    framework_fast_mcp.streamable_http_app()

    mgr = framework_fast_mcp.session_manager

    logger.info("interactive-gltf MCP streamable HTTP mount initialised (%s)", ENGINE_VERSION)

    _streamable_mount_handler = StreamableHTTPASGIApp(mgr)

    return _streamable_mount_handler
