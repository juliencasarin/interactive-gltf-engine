"""Spawn local IDE CLI on the API host (desktop authoring only)."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

_IDE_ARGS = {
    "cursor": (["cursor"], ["-n"]),
    "vscode": (["code"], ["-n"]),
    "jetbrains": (["idea", "idea64", "idea64.exe"], []),
}


def _which_first(names: list[str]) -> str | None:
    for name in names:
        path = shutil.which(name)
        if path:
            return path
    return None


def spawn_ide_for_folder(folder: Path, preset: str) -> None:
    """Start IDE opening ``folder``; raises ``ValueError`` if CLI missing or preset unknown."""
    key = preset.strip().lower()
    if key not in _IDE_ARGS:
        raise ValueError(f"unsupported IDE preset: {preset!r}")
    names, extra = _IDE_ARGS[key]
    exe = _which_first(names)
    if not exe:
        raise ValueError(f"executable not found in PATH (tried {', '.join(names)})")
    resolved = folder.resolve()
    cmd = [exe, *extra, str(resolved)]
    # Detach so the HTTP request returns without waiting for the GUI editor.
    if sys.platform == "win32":
        subprocess.Popen(
            cmd,
            close_fds=True,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        subprocess.Popen(
            cmd,
            start_new_session=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
