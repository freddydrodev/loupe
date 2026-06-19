//! Tauri command surface. Every command returns `Result<_, String>`; the webview
//! only ever sees serialized, secret-free data.

use crate::db::{open_pool, Active, AppState};
use crate::error::AppError;
use crate::introspect::{self, ColumnInfo, ConstraintInfo, IndexInfo, SchemaNode};
use crate::model::{ConnectionMeta, SslMode};
use crate::query::{self, QueryOpts, QueryOutcome};
use crate::rows::{self, GetRowsOpts, RowsResult};
use crate::secrets;
use sqlx::postgres::PgConnectOptions;
use std::str::FromStr;
use tauri::State;

/// Resolves the password to use for a test/connect: an explicitly supplied one,
/// otherwise the secret stored for an existing connection.
async fn resolve_password(
    meta: &ConnectionMeta,
    password: Option<String>,
) -> Result<String, AppError> {
    if let Some(pw) = password {
        if !pw.is_empty() {
            return Ok(pw);
        }
    }
    if !meta.id.is_empty() {
        if let Some(pw) = secrets::get_password(&meta.id)? {
            return Ok(pw);
        }
    }
    Err(AppError::Validation("A password is required.".into()))
}

#[tauri::command]
pub async fn list_connections(
    state: State<'_, AppState>,
) -> Result<Vec<ConnectionMeta>, String> {
    Ok(state.store.lock().await.list())
}

#[tauri::command]
pub async fn save_connection(
    state: State<'_, AppState>,
    meta: ConnectionMeta,
    password: Option<String>,
) -> Result<ConnectionMeta, String> {
    if meta.label.trim().is_empty() {
        return Err("A label is required.".into());
    }
    let is_new = meta.id.is_empty();
    let has_password = password.as_ref().is_some_and(|p| !p.is_empty());
    if is_new && !has_password {
        return Err("A password is required for a new connection.".into());
    }

    let saved = state.store.lock().await.upsert(meta)?;
    if has_password {
        // unwrap is safe: has_password guarantees Some(non-empty).
        secrets::set_password(&saved.id, &password.unwrap())?;
    }
    Ok(saved)
}

#[tauri::command]
pub async fn delete_connection(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    // Drop the active pool if it belongs to the connection being removed.
    {
        let mut active = state.active.lock().await;
        if active.as_ref().is_some_and(|a| a.meta.id == id) {
            if let Some(a) = active.take() {
                a.pool.close().await;
            }
        }
    }
    state.store.lock().await.remove(&id)?;
    secrets::delete_password(&id)?;
    Ok(())
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    meta: ConnectionMeta,
    password: Option<String>,
) -> Result<(), String> {
    let _ = &state; // state unused beyond signature symmetry; kept for parity.
    let pw = resolve_password(&meta, password).await?;
    let pool = open_pool(&meta, pw).await?;
    // SELECT 1 already ran inside open_pool; close the throwaway pool.
    pool.close().await;
    Ok(())
}

#[tauri::command]
pub async fn connect(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let meta = state
        .store
        .lock()
        .await
        .get(&id)
        .ok_or("Unknown connection.")?;
    let pw = secrets::get_password(&id)?
        .ok_or("No saved password for this connection. Edit it to set one.")?;
    let pool = open_pool(&meta, pw).await?;

    let mut active = state.active.lock().await;
    if let Some(prev) = active.take() {
        prev.pool.close().await;
    }
    *active = Some(Active { meta, pool });
    Ok(())
}

#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(active) = state.active.lock().await.take() {
        active.pool.close().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn current_connection(
    state: State<'_, AppState>,
) -> Result<Option<ConnectionMeta>, String> {
    Ok(state.active.lock().await.as_ref().map(|a| a.meta.clone()))
}

// ── Schema introspection ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_schema_tree(
    state: State<'_, AppState>,
) -> Result<Vec<SchemaNode>, String> {
    let pool = state.pool().await?;
    Ok(introspect::schema_tree(&pool).await?)
}

#[tauri::command]
pub async fn get_table_columns(
    state: State<'_, AppState>,
    schema: String,
    table: String,
) -> Result<Vec<ColumnInfo>, String> {
    let pool = state.pool().await?;
    Ok(introspect::table_columns(&pool, &schema, &table).await?)
}

#[tauri::command]
pub async fn get_rows(
    state: State<'_, AppState>,
    schema: String,
    table: String,
    opts: GetRowsOpts,
) -> Result<RowsResult, String> {
    let pool = state.pool().await?;
    Ok(rows::get_rows(&pool, &schema, &table, &opts).await?)
}

#[tauri::command]
pub async fn run_query(
    state: State<'_, AppState>,
    sql: String,
    opts: QueryOpts,
) -> Result<QueryOutcome, String> {
    let (pool, meta) = state.active_meta().await?;
    // A read-only connection can never be overridden into a writable run.
    let read_only = meta.read_only || opts.read_only;
    Ok(query::run_query(&pool, &sql, read_only).await?)
}

#[tauri::command]
pub async fn get_table_indexes(
    state: State<'_, AppState>,
    schema: String,
    table: String,
) -> Result<Vec<IndexInfo>, String> {
    let pool = state.pool().await?;
    Ok(introspect::table_indexes(&pool, &schema, &table).await?)
}

#[tauri::command]
pub async fn get_table_constraints(
    state: State<'_, AppState>,
    schema: String,
    table: String,
) -> Result<Vec<ConstraintInfo>, String> {
    let pool = state.pool().await?;
    Ok(introspect::table_constraints(&pool, &schema, &table).await?)
}

/// Parses a libpq/URL connection string into editable, **secret-free** metadata.
/// Any password in the string is intentionally dropped — the user re-enters it,
/// keeping the frontend free of credentials.
#[tauri::command]
pub async fn parse_connection_string(url: String) -> Result<ConnectionMeta, String> {
    let opts = PgConnectOptions::from_str(&url)
        .map_err(|e| format!("Could not parse connection string: {e}"))?;
    let database = opts.get_database().unwrap_or("").to_string();
    let host = opts.get_host().to_string();
    Ok(ConnectionMeta {
        id: String::new(),
        label: if database.is_empty() {
            host.clone()
        } else {
            database.clone()
        },
        host,
        port: opts.get_port(),
        database,
        username: opts.get_username().to_string(),
        ssl_mode: SslMode::Require,
        root_cert_path: None,
        read_only: false,
        is_prod: false,
        statement_timeout_ms: 30_000,
        row_limit: 1_000,
    })
}
