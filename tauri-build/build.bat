@echo off
setlocal
pushd "%~dp0.." || exit /b 1

echo [build] Freeze FastAPI backend (PyInstaller one-folder)...
pushd igltf-editor-backend || goto :fail
call npm ci || goto :fail
call uv sync --extra packaging || goto :fail
call uv run pyinstaller scripts\igltf-backend.spec --distpath ..\igltf-editor-frontend\resources --workpath pyinstaller-build\work --clean --noconfirm || goto :fail
popd

echo [build] npm ci + Tauri bundle ^(installer needs NSIS on PATH — see tauri-build\README.md^)
pushd igltf-editor-frontend || goto :fail
call npm ci || goto :fail

echo [build] Clean prior Tauri release artifacts ^(stale app.exe, bundle, nsis^)...
if exist src-tauri\target\release rmdir /s /q src-tauri\target\release

call npm run tauri build || goto :fail
popd

popd
echo Done.
exit /b 0

:fail
echo.
echo BUILD FAILED — see messages above.
popd
popd 2>nul
exit /b 1
