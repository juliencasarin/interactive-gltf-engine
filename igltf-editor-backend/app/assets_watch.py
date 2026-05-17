"""Per-project ``assets/`` directory watch + WebSocket fan-out for disk sync."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections import defaultdict
from pathlib import Path
from typing import Any

from starlette.websockets import WebSocket, WebSocketDisconnect
from watchfiles import Change, awatch

from app.assets_disk_sync import sync_assets_from_disk_async

logger = logging.getLogger(__name__)

_ASSET_WATCH_SUFFIXES = frozenset({".glb", ".gltf", ".js", ".mjs", ".cjs"})


def _workspace_disk_watch_filter(workspace: Path):
    """Limit notifications to catalogue-affecting paths (avoid build/, .git, etc.)."""

    root = workspace.resolve()

    def _wf(_change: Change, path_str: str) -> bool:
        path = Path(path_str)
        if path.is_dir():
            return False
        try:
            rel = path.resolve().relative_to(root)
        except ValueError:
            return False
        parts = rel.parts
        if len(parts) == 1 and parts[0] == "project.json":
            return True
        if parts and parts[0] == "assets" and path.suffix.lower() in _ASSET_WATCH_SUFFIXES:
            return True
        return False

    return _wf


class AssetsWatchHub:
    """One background ``awatch`` per project id while at least one subscriber is connected."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._clients: dict[str, set[WebSocket]] = defaultdict(set)
        self._watch_tasks: dict[str, asyncio.Task[None]] = {}

    async def _broadcast(self, project_id: str, payload: dict[str, Any]) -> None:
        text = json.dumps(payload, ensure_ascii=False)
        dead: list[WebSocket] = []
        for ws in list(self._clients.get(project_id, ())):
            try:
                await ws.send_text(text)
            except Exception:  # pragma: no cover
                dead.append(ws)
        for ws in dead:
            await self.unsubscribe(project_id, ws)

    async def _watch_loop(self, project_id: str) -> None:
        from app.storage import assets_dir, project_dir

        base = project_dir(project_id).resolve()
        assets_dir(project_id).mkdir(parents=True, exist_ok=True)
        filt = _workspace_disk_watch_filter(base)

        try:
            async for _changes in awatch(base, debounce=300, watch_filter=filt):
                events = await sync_assets_from_disk_async(project_id)
                await self._broadcast(
                    project_id,
                    {"channel": "assets_disk", "payload": {"events": events}},
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("assets watch crashed for project %s", project_id)
            await self._broadcast(
                project_id,
                {
                    "channel": "assets_disk",
                    "payload": {"error": "watch_internal_error"},
                },
            )

    async def _ensure_watch(self, project_id: str) -> None:
        async with self._lock:
            task = self._watch_tasks.get(project_id)
            if task is None or task.done():
                self._watch_tasks[project_id] = asyncio.create_task(
                    self._watch_loop(project_id),
                    name=f"assets-watch-{project_id}",
                )

    async def _cancel_watch_if_idle(self, project_id: str) -> None:
        async with self._lock:
            if self._clients.get(project_id):
                return
            t = self._watch_tasks.pop(project_id, None)
        if t is not None:
            t.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await t

    async def subscribe(self, project_id: str, websocket: WebSocket) -> None:
        self._clients[project_id].add(websocket)
        await self._ensure_watch(project_id)

    async def unsubscribe(self, project_id: str, websocket: WebSocket) -> None:
        bucket = self._clients.get(project_id)
        if bucket is None:
            return
        bucket.discard(websocket)
        if not bucket:
            self._clients.pop(project_id, None)
            await self._cancel_watch_if_idle(project_id)


assets_watch_hub = AssetsWatchHub()


async def handle_assets_watch_websocket(project_id: str, websocket: WebSocket) -> None:
    from app.storage import resolve_project_root

    try:
        resolve_project_root(project_id)
    except ValueError as e:
        await websocket.close(code=4400, reason=str(e)[:120])
        return

    await websocket.accept()
    await assets_watch_hub.subscribe(project_id, websocket)
    try:
        initial = await sync_assets_from_disk_async(project_id)
        await websocket.send_json(
            {
                "channel": "assets_disk",
                "payload": {"hello": True, "events": initial},
            },
        )
    except Exception:  # pragma: no cover
        await assets_watch_hub.unsubscribe(project_id, websocket)
        return

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await assets_watch_hub.unsubscribe(project_id, websocket)
