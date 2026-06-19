// Lagune — desktop PostgreSQL client.
//
// The webview never receives credentials or a connection string. It talks to
// the Rust core exclusively through the Tauri commands registered below.

/// Liveness probe used by the frontend to confirm the Rust core is reachable.
#[tauri::command]
fn app_ready() -> &'static str {
    "lagune"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![app_ready])
        .run(tauri::generate_context!())
        .expect("error while running Lagune");
}
