//! Serializable types shared between Rust and the webview.
//!
//! Every struct returned to the frontend uses `camelCase`. None of them carry
//! secrets — the password lives only in the OS keychain.

use serde::{Deserialize, Serialize};

/// TLS policy for a connection. Lagune never offers a non-TLS mode: the weakest
/// option is `require`, and `verify-full` additionally checks the server cert.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SslMode {
    Require,
    VerifyFull,
}

impl Default for SslMode {
    fn default() -> Self {
        SslMode::Require
    }
}

fn default_statement_timeout_ms() -> u32 {
    30_000
}

fn default_row_limit() -> u32 {
    1_000
}

/// Non-secret metadata for a saved connection. Persisted to the app config dir.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionMeta {
    /// Stable identifier; also the keychain account name. Generated on save.
    #[serde(default)]
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    #[serde(default)]
    pub ssl_mode: SslMode,
    /// Path to a root CA certificate, used only with `verify-full`.
    #[serde(default)]
    pub root_cert_path: Option<String>,
    /// Read-only guard for the whole connection.
    #[serde(default)]
    pub read_only: bool,
    /// Marks a production database; the UI defaults such connections to read-only.
    #[serde(default)]
    pub is_prod: bool,
    #[serde(default = "default_statement_timeout_ms")]
    pub statement_timeout_ms: u32,
    #[serde(default = "default_row_limit")]
    pub row_limit: u32,
}
