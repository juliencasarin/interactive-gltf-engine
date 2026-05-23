"""Live editor session store + bidirectional WebSocket for MCP scene commands."""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from starlette.websockets import WebSocket, WebSocketDisconnect

from app.storage import ensure_project_layout

logger = logging.getLogger(__name__)

COMMAND_TIMEOUT_S = 10.0


class EditorSessionError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass
class EditorSessionState:
    project_id: str
    revision: int = 0
    mcp_allow_scene_edition: bool = False
    snapshot: dict[str, Any] = field(default_factory=dict)
    websocket: WebSocket | None = None
    pending: dict[str, asyncio.Future[dict[str, Any]]] = field(default_factory=dict)


class EditorSessionHub:
    def __init__(self) -> None:
        self._sessions: dict[str, EditorSessionState] = {}

    def get(self, project_id: str) -> EditorSessionState | None:
        return self._sessions.get(project_id)

    def require_live(self, project_id: str) -> EditorSessionState:
        sess = self._sessions.get(project_id)
        if sess is None or not sess.snapshot:
            raise EditorSessionError("no_live_session", f"No live editor session for project {project_id!r}")
        return sess

    def require_scene_edit(self, project_id: str) -> EditorSessionState:
        sess = self.require_live(project_id)
        if not sess.mcp_allow_scene_edition:
            raise EditorSessionError(
                "mcp_scene_edition_disabled",
                "MCP scene edition is disabled for this project (enable in editor Settings).",
            )
        if sess.websocket is None:
            raise EditorSessionError(
                "editor_not_connected",
                f"Editor is not connected for project {project_id!r}.",
            )
        return sess

    async def register_client(self, project_id: str, websocket: WebSocket) -> EditorSessionState:
        prev = self._sessions.get(project_id)
        if prev and prev.websocket is not None and prev.websocket is not websocket:
            try:
                await prev.websocket.close(code=4000, reason="replaced by new editor session")
            except Exception:
                pass
            for fut in prev.pending.values():
                if not fut.done():
                    fut.set_exception(
                        EditorSessionError("editor_disconnected", "Editor session replaced")
                    )
            prev.pending.clear()
            prev.websocket = None

        if prev is None:
            prev = EditorSessionState(project_id=project_id)
            self._sessions[project_id] = prev
        prev.websocket = websocket
        return prev

    async def unregister_client(self, project_id: str, websocket: WebSocket) -> None:
        sess = self._sessions.get(project_id)
        if sess is None or sess.websocket is not websocket:
            return
        sess.websocket = None
        for fut in sess.pending.values():
            if not fut.done():
                fut.set_exception(EditorSessionError("editor_disconnected", "Editor disconnected"))
        sess.pending.clear()

    def apply_register_or_update(self, project_id: str, msg: dict[str, Any]) -> EditorSessionState:
        sess = self._sessions.get(project_id)
        if sess is None:
            sess = EditorSessionState(project_id=project_id)
            self._sessions[project_id] = sess

        rev = msg.get("revision")
        if isinstance(rev, int) and rev >= 0:
            sess.revision = rev

        snap = msg.get("snapshot")
        if isinstance(snap, dict):
            sess.snapshot = snap

        mcp = msg.get("mcpAllowSceneEdition")
        if isinstance(mcp, bool):
            sess.mcp_allow_scene_edition = mcp
        elif isinstance(snap, dict):
            es = snap.get("editorSettings")
            if isinstance(es, dict) and es.get("mcpAllowSceneEdition") is True:
                sess.mcp_allow_scene_edition = True
            elif isinstance(es, dict):
                sess.mcp_allow_scene_edition = False

        return sess

    def resolve_command_result(self, project_id: str, msg: dict[str, Any]) -> None:
        sess = self._sessions.get(project_id)
        if sess is None:
            return
        rid = msg.get("requestId")
        if not isinstance(rid, str):
            return
        fut = sess.pending.pop(rid, None)
        if fut is None or fut.done():
            return
        fut.set_result(msg)

    async def dispatch_command(
        self,
        project_id: str,
        op: str,
        params: dict[str, Any],
        *,
        require_mcp_scene_edition: bool = True,
    ) -> dict[str, Any]:
        if require_mcp_scene_edition:
            sess = self.require_scene_edit(project_id)
        else:
            sess = self.require_live(project_id)
            if sess.websocket is None:
                raise EditorSessionError(
                    "editor_not_connected",
                    f"Editor is not connected for project {project_id!r}.",
                )
        ws = sess.websocket
        if ws is None:
            raise EditorSessionError("editor_not_connected", "Editor disconnected")

        request_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[dict[str, Any]] = loop.create_future()
        sess.pending[request_id] = fut

        try:
            await ws.send_json({"type": "command", "requestId": request_id, "op": op, "params": params})
        except Exception as e:
            sess.pending.pop(request_id, None)
            raise EditorSessionError("editor_not_connected", f"Failed to send command: {e}") from e

        try:
            result = await asyncio.wait_for(fut, timeout=COMMAND_TIMEOUT_S)
        except asyncio.TimeoutError as e:
            sess.pending.pop(request_id, None)
            raise EditorSessionError("command_timeout", f"Editor did not respond within {COMMAND_TIMEOUT_S}s") from e

        if not result.get("ok"):
            err = result.get("error")
            if isinstance(err, dict):
                code = str(err.get("code") or "command_failed")
                message = str(err.get("message") or "Command failed")
                raise EditorSessionError(code, message)
            raise EditorSessionError("command_failed", str(err or "Command failed"))

        out: dict[str, Any] = {"ok": True}
        if isinstance(result.get("revision"), int):
            out["revision"] = result["revision"]
        if "result" in result:
            out["result"] = result["result"]
        return out


editor_session_hub = EditorSessionHub()


async def handle_editor_session_websocket(project_id: str, websocket: WebSocket) -> None:
    try:
        ensure_project_layout(project_id)
    except ValueError as e:
        await websocket.close(code=4400, reason=str(e)[:120])
        return

    await websocket.accept()
    await editor_session_hub.register_client(project_id, websocket)

    try:
        await websocket.send_json(
            {
                "type": "hello",
                "projectId": project_id,
            }
        )
        while True:
            raw = await websocket.receive_text()
            try:
                msg = __import__("json").loads(raw)
            except Exception:
                continue
            if not isinstance(msg, dict):
                continue

            mtype = msg.get("type")
            if mtype in ("session_register", "session_update"):
                editor_session_hub.apply_register_or_update(project_id, msg)
            elif mtype == "command_result":
                editor_session_hub.resolve_command_result(project_id, msg)
    except WebSocketDisconnect:
        pass
    finally:
        await editor_session_hub.unregister_client(project_id, websocket)
