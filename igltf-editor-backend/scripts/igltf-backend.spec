# -*- mode: python ; coding: utf-8 -*-
"""Pinned PyInstaller spec — build:
  uv sync --extra packaging
  uv run pyinstaller scripts/igltf-backend.spec --distpath ../igltf-editor-frontend/resources --workpath pyinstaller-build/work --clean --noconfirm
"""

from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

# PyInstaller exec() namespace provides SPECPATH (this spec's directory); __file__ is not set.
project_root = Path(SPECPATH).resolve().parent

block_cipher = None

datas = []
binaries = []
hiddenimports = []
hiddenimports += collect_submodules("app")
for pkg in (
    "uvicorn",
    "fastapi",
    "starlette",
    "pydantic",
    "pydantic_core",
    "multipart",
    "dotenv",
    "pygltflib",
    "mcp",
    "httpx",
    "anyio",
    "jsonschema",
    "sse_starlette",
    "watchfiles",
):
    # mcp.cli pulls optional deps (typer) not installed in this project; embedded server uses mcp.server only.
    tmp = (
        collect_all(
            pkg,
            filter_submodules=lambda name: not name.startswith("mcp.cli"),
        )
        if pkg == "mcp"
        else collect_all(pkg)
    )
    datas += tmp[0]
    binaries += tmp[1]
    hiddenimports += tmp[2]

datas.append((project_root / "authoring_kit", "authoring_kit"))

a = Analysis(
    [str(project_root / "scripts" / "igltf_backend_entry.py")],
    pathex=[str(project_root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="igltf-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="igltf-backend",
)
