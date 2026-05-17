"""Serialized filesystem + catalogue mutations per project id (threads)."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from threading import Lock

Locks: dict[str, Lock] = {}


def _lock_for_pid(project_id: str) -> Lock:
    lk = Locks.get(project_id)
    if lk is None:
        lk = Lock()
        Locks[project_id] = lk
    return lk


@contextmanager
def project_fs_lock(project_id: str) -> Generator[None, None, None]:
    with _lock_for_pid(project_id):
        yield
