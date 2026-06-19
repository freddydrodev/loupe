// Lagune — desktop PostgreSQL client.
//
// The webview never receives credentials or a connection string. It talks to
// the Rust core exclusively through the Tauri commands registered below.

mod cell;
mod commands;
mod db;
mod error;
mod introspect;
mod model;
mod rows;
mod secrets;
mod sql;
mod store;

use db::AppState;
use store::ConnectionStore;
use tauri::Manager;

/// Liveness probe used by the frontend to confirm the Rust core is reachable.
#[tauri::command]
fn app_ready() -> &'static str {
    "lagune"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            let store = ConnectionStore::load(dir.join("connections.json"))?;
            app.manage(AppState::new(store));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_ready,
            commands::list_connections,
            commands::save_connection,
            commands::delete_connection,
            commands::test_connection,
            commands::connect,
            commands::disconnect,
            commands::current_connection,
            commands::parse_connection_string,
            commands::list_schema_tree,
            commands::get_table_columns,
            commands::get_rows,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lagune");
}
