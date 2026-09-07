//! SQLite database: one file for the whole daemon, Diesel migrations on start.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use diesel::connection::SimpleConnection;
use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};

use bigfred_shared_daemon::DataDir;

use crate::error::ApiError;

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

pub type Db = Arc<Mutex<SqliteConnection>>;

#[must_use]
pub fn default_db_path(data_dir: &DataDir) -> PathBuf {
    data_dir.join(["var", "lib", "bigfred", "programming-center", "db.sqlite3"])
}

/// Open (or create) `db.sqlite3` and apply pending Diesel migrations.
pub fn open(path: &Path) -> Result<Db, ApiError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| ApiError::internal("db_create_failed").with_detail(err.to_string()))?;
    }
    let url = path.to_str().ok_or_else(|| {
        ApiError::internal("db_path_invalid").with_detail(path.display().to_string())
    })?;
    let mut conn = SqliteConnection::establish(url)
        .map_err(|err| ApiError::internal("db_open_failed").with_detail(err.to_string()))?;
    conn.batch_execute("PRAGMA foreign_keys = ON")
        .map_err(|err| ApiError::internal("db_pragma_failed").with_detail(err.to_string()))?;
    run_migrations(&mut conn)?;
    Ok(Arc::new(Mutex::new(conn)))
}

pub fn run_migrations(conn: &mut SqliteConnection) -> Result<(), ApiError> {
    conn.run_pending_migrations(MIGRATIONS)
        .map_err(|err| ApiError::internal("db_migrate_failed").with_detail(err.to_string()))?;
    Ok(())
}

pub fn lock(db: &Db) -> Result<std::sync::MutexGuard<'_, SqliteConnection>, ApiError> {
    db.lock()
        .map_err(|_| ApiError::internal("db_lock_poisoned"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn migrates_empty_file_twice() {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().join("db.sqlite3");
        let db = open(&path).expect("open");
        {
            let mut conn = lock(&db).expect("lock");
            run_migrations(&mut conn).expect("second migrate");
        }
        assert!(path.exists());
    }
}
