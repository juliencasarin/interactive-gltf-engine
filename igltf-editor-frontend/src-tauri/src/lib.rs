use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, RunEvent, State};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

pub struct BackendChild(pub Mutex<Option<Child>>);

#[cfg(target_os = "windows")]
const BACKEND_EXE: &str = "igltf-backend.exe";
#[cfg(not(target_os = "windows"))]
const BACKEND_EXE: &str = "igltf-backend";

fn dev_backend_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("igltf-editor-backend")
}

fn spawn_backend_dev() -> Result<Child, String> {
    let cwd = dev_backend_root();
    if !cwd.join("pyproject.toml").is_file() {
        return Err(format!(
            "igltf-editor-backend not found at {} (required for \"tauri dev\")",
            cwd.display()
        ));
    }

    let mut cmd = Command::new("uv");
    cmd.current_dir(&cwd);
    cmd.args([
        "run",
        "uvicorn",
        "app.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8000",
    ]);
    cmd.stdin(Stdio::null());
    cmd.stderr(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.spawn()
        .map_err(|e| format!("failed to spawn `uv run uvicorn` in {}: {e}", cwd.display()))
}

fn spawn_backend_packaged(app: &AppHandle) -> Result<Child, String> {
    let dir = app
        .path()
        .resolve(Path::new("igltf-backend"), BaseDirectory::Resource)
        .map_err(|e| format!("resolve igltf-backend resource: {e}"))?;

    let exe = dir.join(BACKEND_EXE);
    if !exe.is_file() {
        return Err(format!(
            "bundled backend missing at {} — run igltf-build (see ../tauri-build)",
            exe.display()
        ));
    }

    let storage = backend_storage_dir(app)?;
    std::fs::create_dir_all(&storage)
        .map_err(|e| format!("could not create storage dir {:?}: {e}", storage))?;

    let mut cmd = Command::new(exe.clone());
    cmd.current_dir(dir);
    cmd.stdin(Stdio::null());
    cmd.stderr(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.env("IGLTF_BIND_HOST", "127.0.0.1");
    cmd.env("IGLTF_PORT", "8000");
    cmd.env(
        "STORAGE_ROOT",
        storage
            .to_str()
            .ok_or_else(|| format!("storage path encoding: {:?}", storage))?,
    );
    cmd.env("PUBLIC_BASE_URL", "http://127.0.0.1:8000");
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
        .map_err(|e| format!("failed to start bundled backend {}: {e}", exe.display()))
}

fn backend_storage_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    dir.push("storage");
    Ok(dir)
}

fn spawn_backend_for_app(app: &AppHandle) -> Result<Child, String> {
    if cfg!(debug_assertions) {
        spawn_backend_dev()
    } else {
        spawn_backend_packaged(app)
    }
}

fn ensure_backend_spawned_inner(app: &AppHandle, state: &State<'_, BackendChild>) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "backend process lock poisoned".to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    match spawn_backend_for_app(app) {
        Ok(child) => {
            log::info!("igltf FastAPI backend started (pid {:?})", child.id());
            *guard = Some(child);
            Ok(())
        }
        Err(e) => {
            log::error!("igltf backend failed to start: {e}");
            Err(e)
        }
    }
}

#[tauri::command]
fn igltf_ensure_backend(app: AppHandle, state: State<'_, BackendChild>) -> Result<(), String> {
    ensure_backend_spawned_inner(&app, &state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BackendChild(Mutex::new(None)))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            ensure_backend_spawned_inner(app.handle(), &app.state::<BackendChild>())?;

            #[cfg(debug_assertions)]
            {
                if let Err(e) = app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                ) {
                    log::warn!("tauri_plugin_log disabled: {}", e);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![igltf_ensure_backend])
        .build(tauri::generate_context!())
        .expect("error while building the Tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<BackendChild>() {
                    if let Ok(mut g) = state.0.lock() {
                        if let Some(mut c) = g.take() {
                            let _ = c.kill();
                            let _ = c.try_wait();
                        }
                    }
                }
            }
        });
}
