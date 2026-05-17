"""PyInstaller entrypoint: run the FastAPI app with uvicorn (one-folder build)."""

from __future__ import annotations

import os


def main() -> None:
    import uvicorn

    host = os.environ.get("IGLTF_BIND_HOST", "127.0.0.1")
    port = int(os.environ.get("IGLTF_PORT", "8000"))
    log_level = os.environ.get("LOG_LEVEL", "info")
    uvicorn.run("app.main:app", host=host, port=port, log_level=log_level)


if __name__ == "__main__":
    main()
