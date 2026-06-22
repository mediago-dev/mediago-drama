use std::sync::Mutex;

use tauri::path::BaseDirectory;
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const AGENT_ID: &str = match option_env!("MEDIAGO_AGENT_ID") {
    Some(value) => value,
    None => "codex",
};
const SERVER_PORT: &str = match option_env!("MEDIAGO_SERVER_PORT") {
    Some(value) => value,
    None => "48273",
};

struct ServerSidecar(Mutex<Option<CommandChild>>);

impl ServerSidecar {
    fn kill(&self) {
        let Ok(mut child) = self.0.lock() else {
            return;
        };
        if let Some(child) = child.take() {
            let _ = child.kill();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            if !cfg!(debug_assertions) {
                let agents_dir = app
                    .path()
                    .resolve("resources/agents", BaseDirectory::Resource)?;
                let media_tools_dir = app
                    .path()
                    .resolve("resources/tools", BaseDirectory::Resource)?;
                let sidecar = app
                    .shell()
                    .sidecar("mediago-server")?
                    .env("MEDIAGO_AGENT_ID", AGENT_ID)
                    .env("MEDIAGO_SERVER_PORT", SERVER_PORT)
                    .env("MEDIAGO_EXIT_ON_STDIN_CLOSE", "1")
                    .env("MEDIAGO_AGENT_BIN_DIR", agents_dir)
                    .env("MEDIAGO_FFMPEG_BIN_DIR", media_tools_dir.clone())
                    .env("MEDIAGO_JIMENG_BIN_DIR", media_tools_dir);
                let (mut rx, child) = sidecar.spawn()?;
                app.manage(ServerSidecar(Mutex::new(Some(child))));

                tauri::async_runtime::spawn(async move { while rx.recv().await.is_some() {} });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if cfg!(target_os = "macos") {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        kill_server_sidecar(window.app_handle());
                    }
                }
                WindowEvent::Destroyed => {
                    kill_server_sidecar(window.app_handle());
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Reopen {
            has_visible_windows,
            ..
        } = event
        {
            if !has_visible_windows {
                show_main_window(app_handle);
            }
        }

        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            kill_server_sidecar(app_handle);
        }
    });
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn kill_server_sidecar(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<ServerSidecar>() {
        state.kill();
    }
}
