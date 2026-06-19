//! Error type shared by every command.
//!
//! Two rules govern this module:
//!  1. No variant ever carries a password or a full connection string.
//!  2. `Display` output is what reaches the frontend, so it must stay redacted.

use std::fmt;

#[derive(Debug)]
pub enum AppError {
    /// A user-facing validation problem (bad input, missing field).
    Validation(String),
    /// TLS / SSL policy violation.
    Tls(String),
    /// No active connection when one was required.
    NotConnected,
    /// OS keychain failure.
    Keyring(String),
    /// Local config-store IO/serialization failure.
    Store(String),
    /// Database error surfaced from sqlx (already free of credentials).
    Db(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Validation(m) => write!(f, "{m}"),
            AppError::Tls(m) => write!(f, "{m}"),
            AppError::NotConnected => write!(f, "Not connected. Open a connection first."),
            AppError::Keyring(m) => write!(f, "Keychain error: {m}"),
            AppError::Store(m) => write!(f, "Configuration store error: {m}"),
            AppError::Db(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<AppError> for String {
    fn from(e: AppError) -> String {
        e.to_string()
    }
}

impl From<keyring::Error> for AppError {
    fn from(e: keyring::Error) -> Self {
        AppError::Keyring(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Store(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Store(e.to_string())
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        // sqlx error messages do not embed the password or DSN, but database
        // errors (syntax, permission) carry useful, non-secret detail we keep.
        AppError::Db(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
