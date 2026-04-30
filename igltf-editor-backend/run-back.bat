@echo off
cd /d "%~dp0"
if not exist .venv (uv sync)
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
