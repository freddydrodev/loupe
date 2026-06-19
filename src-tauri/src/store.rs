//! File-backed store for connection metadata (no secrets).
//!
//! Persisted as JSON in the app config directory with user-only permissions.
//! Writes are atomic (temp file + rename) so a crash never truncates the store.

use crate::error::AppResult;
use crate::model::ConnectionMeta;
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

pub struct ConnectionStore {
    path: PathBuf,
    items: Vec<ConnectionMeta>,
}

impl ConnectionStore {
    /// Loads the store from `path`, returning an empty store if it does not exist.
    pub fn load(path: PathBuf) -> AppResult<Self> {
        let items = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e.into()),
        };
        Ok(Self { path, items })
    }

    pub fn list(&self) -> Vec<ConnectionMeta> {
        self.items.clone()
    }

    pub fn get(&self, id: &str) -> Option<ConnectionMeta> {
        self.items.iter().find(|c| c.id == id).cloned()
    }

    /// Inserts a new connection (assigning an id) or updates an existing one.
    /// Returns the stored metadata.
    pub fn upsert(&mut self, mut meta: ConnectionMeta) -> AppResult<ConnectionMeta> {
        if meta.id.is_empty() {
            meta.id = Uuid::new_v4().to_string();
            self.items.push(meta.clone());
        } else if let Some(slot) = self.items.iter_mut().find(|c| c.id == meta.id) {
            *slot = meta.clone();
        } else {
            self.items.push(meta.clone());
        }
        self.persist()?;
        Ok(meta)
    }

    pub fn remove(&mut self, id: &str) -> AppResult<()> {
        self.items.retain(|c| c.id != id);
        self.persist()
    }

    fn persist(&self) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_vec_pretty(&self.items)?;
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, &json)?;
        restrict_permissions(&tmp)?;
        fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

#[cfg(unix)]
fn restrict_permissions(path: &std::path::Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &std::path::Path) -> AppResult<()> {
    Ok(())
}
