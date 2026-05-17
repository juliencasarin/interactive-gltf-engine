"""Shared pytest fixtures."""

from __future__ import annotations

from collections.abc import Generator

import pytest
from starlette.testclient import TestClient

@pytest.fixture(scope="session")
def igltf_app_client() -> Generator[TestClient, None, None]:
    """One Starlette ``TestClient`` per session — MCP lifespan cannot be entered twice."""

    from app.main import app

    with TestClient(app) as client:
        yield client
