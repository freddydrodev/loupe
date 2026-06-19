//! Thin wrapper over the OS keychain (`keyring`). Passwords never touch the
//! config file or the frontend — they live here only.

use crate::error::{AppError, AppResult};
use keyring::Entry;

const SERVICE: &str = "dev.freddydro.lagune";

fn entry(id: &str) -> AppResult<Entry> {
    Entry::new(SERVICE, &format!("conn:{id}")).map_err(AppError::from)
}

pub fn set_password(id: &str, password: &str) -> AppResult<()> {
    entry(id)?.set_password(password).map_err(AppError::from)
}

/// Returns the stored password, or `None` if no secret exists for this id.
pub fn get_password(id: &str) -> AppResult<Option<String>> {
    match entry(id)?.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::from(e)),
    }
}

/// Deletes the stored password. Missing entries are treated as success so that
/// deleting a connection is idempotent.
pub fn delete_password(id: &str) -> AppResult<()> {
    match entry(id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::from(e)),
    }
}
