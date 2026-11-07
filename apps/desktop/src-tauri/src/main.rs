#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use enderlink_core::Service;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};
mod removal;
#[derive(Default)]
struct RemovalExit(AtomicBool);
#[tauri::command]
async fn command(
    app: tauri::AppHandle,
    service: tauri::State<'_, Service>,
    action: String,
    args: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let result = service
        .dispatch(&action, args.unwrap_or(serde_json::Value::Null))
        .await
        .map_err(|e| format!("{e:#}"))?;
    if action == "resetAllData"
        && let Some(window) = app.get_webview_window("main")
    {
        window.clear_all_browsing_data().map_err(|e| format!(
            "Your worlds and settings were cleared, but the interface cache could not be cleared: {e}"
        ))?;
    }
    Ok(result)
}
#[tauri::command]
async fn uninstall_info(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    removal::inspect(&app)
}
#[tauri::command]
async fn uninstall_app(
    app: tauri::AppHandle,
    service: tauri::State<'_, Service>,
    token: String,
    phrase: String,
    save_to: Option<std::path::PathBuf>,
) -> Result<(), String> {
    if phrase != "UNINSTALL ENDERLINK" {
        return Err("Type UNINSTALL ENDERLINK exactly.".into());
    }
    // This helper remains inert until the reviewed library policy has succeeded.
    let prepared = removal::prepare(&app)?;
    if let Some(path) = &save_to {
        let parent = path
            .parent()
            .ok_or("Choose a new folder for your saved library")?
            .canonicalize()
            .map_err(|e| format!("Could not open the chosen folder: {e}"))?;
        let destination = parent.join(path.file_name().ok_or("Choose a new folder name")?);
        for root in prepared.deletion_roots() {
            let root = root.canonicalize().unwrap_or_else(|_| root.clone());
            let excluded = if cfg!(windows) {
                let lower = |p: &std::path::Path| {
                    std::path::PathBuf::from(
                        p.to_string_lossy()
                            .trim_start_matches(r"\\?\")
                            .to_lowercase(),
                    )
                };
                lower(&destination).starts_with(lower(&root))
            } else {
                destination.starts_with(&root)
            };
            if excluded {
                return Err(
                    "Choose a save folder outside Enderlink's application, data and cache folders."
                        .into(),
                );
            }
        }
    }
    let maintenance = service
        .prepare_uninstall(&token, &phrase, save_to.as_deref())
        .await
        .map_err(|e| format!("{e:#}"))?;
    prepared.commit().map_err(|e| {
        let saved = save_to
            .as_ref()
            .map(|path| format!(" Your saved library is in {}.", path.display()))
            .unwrap_or_default();
        format!("Local data has been cleared, but Enderlink is still installed.{saved} {e}")
    })?;
    maintenance.hold_until_exit();
    app.state::<RemovalExit>().0.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}
#[tauri::command]
async fn quit(app: tauri::AppHandle, service: tauri::State<'_, Service>) -> Result<(), String> {
    if service.is_maintenance_active() {
        return Err("Wait for the maintenance operation to finish before quitting.".into());
    }
    service.shutdown().await.map_err(|e| format!("{e:#}"))?;
    app.exit(0);
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(RemovalExit::default());
            let service = Service::new(app.path().app_data_dir()?)?;
            app.manage(service.clone());
            // Native credential stores may wait for a system permission dialog.
            // Keep that wait off the window/event-loop thread.
            tauri::async_runtime::spawn_blocking(move || service.load_provider_secret());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            command,
            quit,
            uninstall_info,
            uninstall_app
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let service = window.state::<Service>();
                if service.is_maintenance_active() {
                    api.prevent_close();
                    return;
                }
                if service
                    .session
                    .lock()
                    .unwrap()
                    .as_ref()
                    .is_some_and(|s| s.pid.is_some())
                {
                    api.prevent_close();
                    let _ = window.emit("confirm-close", ());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Could not start Enderlink")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let service = app.state::<Service>();
                if service.is_maintenance_active()
                    && !app.state::<RemovalExit>().0.load(Ordering::SeqCst)
                {
                    api.prevent_exit();
                    return;
                }
                if service
                    .session
                    .lock()
                    .unwrap()
                    .as_ref()
                    .is_some_and(|s| s.pid.is_some())
                {
                    api.prevent_exit();
                    let _ = app.emit("confirm-close", ());
                } else {
                    service.stop_provider();
                }
            }
        });
}
