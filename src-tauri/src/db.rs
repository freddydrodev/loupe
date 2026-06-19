//! Active-connection state and TLS-enforced pool construction.

use crate::error::{AppError, AppResult};
use crate::model::{ConnectionMeta, SslMode};
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgSslMode};
use std::time::Duration;
use tokio::sync::Mutex;
use zeroize::Zeroize;

/// The currently open connection: its pool and the metadata it was opened with.
pub struct Active {
    pub meta: ConnectionMeta,
    pub pool: PgPool,
}

/// Tauri-managed application state.
pub struct AppState {
    /// File-backed connection metadata store.
    pub store: Mutex<crate::store::ConnectionStore>,
    /// The single active connection, if any.
    pub active: Mutex<Option<Active>>,
}

impl AppState {
    pub fn new(store: crate::store::ConnectionStore) -> Self {
        Self {
            store: Mutex::new(store),
            active: Mutex::new(None),
        }
    }

    /// Returns a clone of the active pool, or `NotConnected`.
    pub async fn pool(&self) -> AppResult<PgPool> {
        self.active
            .lock()
            .await
            .as_ref()
            .map(|a| a.pool.clone())
            .ok_or(AppError::NotConnected)
    }

    /// Returns the active pool together with the meta it was opened with.
    pub async fn active_meta(&self) -> AppResult<(PgPool, ConnectionMeta)> {
        self.active
            .lock()
            .await
            .as_ref()
            .map(|a| (a.pool.clone(), a.meta.clone()))
            .ok_or(AppError::NotConnected)
    }
}

/// Builds TLS-enforced connect options from metadata and a password.
///
/// `password` is taken by value and wiped before returning. The result never
/// uses `PgSslMode::Disable`/`Allow`/`Prefer`, so a plaintext connection is
/// impossible by construction. `channel_binding` is deliberately never set —
/// sqlx does not support it and including it would break Neon auth.
pub fn build_options(meta: &ConnectionMeta, mut password: String) -> AppResult<PgConnectOptions> {
    if meta.host.trim().is_empty() {
        return Err(AppError::Validation("Host is required.".into()));
    }
    if meta.database.trim().is_empty() {
        return Err(AppError::Validation("Database is required.".into()));
    }

    let ssl = match meta.ssl_mode {
        SslMode::Require => PgSslMode::Require,
        SslMode::VerifyFull => PgSslMode::VerifyFull,
    };

    let mut opts = PgConnectOptions::new()
        .host(&meta.host)
        .port(meta.port)
        .database(&meta.database)
        .username(&meta.username)
        .password(&password)
        .ssl_mode(ssl)
        .application_name("Lagune");

    if meta.ssl_mode == SslMode::VerifyFull {
        match &meta.root_cert_path {
            Some(path) if !path.trim().is_empty() => {
                opts = opts.ssl_root_cert(path);
            }
            _ => {
                return Err(AppError::Tls(
                    "verify-full requires a root certificate path.".into(),
                ));
            }
        }
    }

    // Session GUCs applied at startup via the libpq `options` parameter.
    let timeout = meta.statement_timeout_ms.to_string();
    let mut guc: Vec<(&str, &str)> = vec![("statement_timeout", timeout.as_str())];
    if meta.read_only {
        guc.push(("default_transaction_read_only", "on"));
    }
    opts = opts.options(guc);

    password.zeroize();
    Ok(opts)
}

/// Opens a pool and verifies it with `SELECT 1`.
pub async fn open_pool(meta: &ConnectionMeta, password: String) -> AppResult<PgPool> {
    let opts = build_options(meta, password)?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(15))
        .connect_with(opts)
        .await
        .map_err(map_connect_error)?;
    sqlx::query("SELECT 1").execute(&pool).await?;
    Ok(pool)
}

/// Translates low-level connect failures into actionable, redacted messages.
fn map_connect_error(e: sqlx::Error) -> AppError {
    let msg = e.to_string();
    let lower = msg.to_lowercase();
    if lower.contains("tls")
        || lower.contains("ssl")
        || lower.contains("certificate")
        || lower.contains("server does not support")
    {
        AppError::Tls(format!(
            "TLS negotiation failed — the server may not support SSL, which Lagune requires. ({msg})"
        ))
    } else {
        AppError::Db(msg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::SslMode;

    fn meta(ssl: SslMode, cert: Option<&str>) -> ConnectionMeta {
        ConnectionMeta {
            id: String::new(),
            label: "t".into(),
            host: "localhost".into(),
            port: 5432,
            database: "db".into(),
            username: "u".into(),
            ssl_mode: ssl,
            root_cert_path: cert.map(String::from),
            read_only: false,
            is_prod: false,
            statement_timeout_ms: 30_000,
            row_limit: 1_000,
        }
    }

    #[test]
    fn require_mode_builds() {
        assert!(build_options(&meta(SslMode::Require, None), "pw".into()).is_ok());
    }

    #[test]
    fn verify_full_requires_cert() {
        // verify-full with no certificate is a TLS policy error, not a silent
        // downgrade.
        let err = build_options(&meta(SslMode::VerifyFull, None), "pw".into()).unwrap_err();
        assert!(matches!(err, AppError::Tls(_)));
    }

    #[test]
    fn empty_host_rejected() {
        let mut m = meta(SslMode::Require, None);
        m.host = "  ".into();
        let err = build_options(&m, "pw".into()).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
    }
}
