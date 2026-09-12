//! wireless-programmer IPC supervisor and local firmware-file sandbox.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use tokio::sync::RwLock;
use tokio::time::timeout;

use bigfred_shared_daemon::DataDir;
use pc_proto::{
    FirmwareCandidate, FirmwareFile, CODE_INVALID_FIRMWARE_FILE, CODE_WP_UNAVAILABLE, RB23XX_DRIVER,
};
use wp_client::{CandidateRef, Client, ClientError, ReachMode};

use crate::config::Config;
use crate::error::ApiError;

/// Connect / `hello` deadline (not in JSON).
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
/// Radio `scan` needs more than the connect timeout (~8 s on air).
const SCAN_TIMEOUT: Duration = Duration::from_secs(20);
/// `updateFirmware` only queues a job.
const UPDATE_TIMEOUT: Duration = Duration::from_secs(10);
/// Per-frame idle on `job.watch`. Join can take ~20 s (wpa_supplicant)
/// before the daemon emits HTTP heartbeats every 3 s.
const WATCH_IDLE: Duration = Duration::from_secs(60);

/// Live IPC reachability for the SPA (`PublicConfig.wirelessProgrammer.connected`).
pub struct WpLink {
    connected: AtomicBool,
}

impl WpLink {
    #[must_use]
    pub fn spawn(cfg: Arc<RwLock<Config>>) -> Arc<Self> {
        let link = Arc::new(Self {
            connected: AtomicBool::new(false),
        });
        let loop_link = Arc::clone(&link);
        tokio::spawn(async move {
            loop_hello(loop_link, cfg).await;
        });
        link
    }

    #[must_use]
    pub fn connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }

    pub fn set_connected(&self, ok: bool) {
        self.connected.store(ok, Ordering::Relaxed);
    }
}

async fn loop_hello(link: Arc<WpLink>, cfg: Arc<RwLock<Config>>) {
    loop {
        let (enabled, interval) = {
            let guard = cfg.read().await;
            (
                guard.wireless_programmer.enabled,
                guard.wireless_programmer.socket_connect_retry_interval,
            )
        };
        if !enabled {
            link.set_connected(false);
            tokio::time::sleep(Duration::from_secs(1)).await;
            continue;
        }
        let ok = hello().await.is_ok();
        if ok != link.connected() {
            if ok {
                tracing::info!("wireless-programmer IPC connected");
            } else {
                tracing::warn!("wireless-programmer IPC unreachable");
            }
        }
        link.set_connected(ok);
        let secs = interval.max(1);
        tokio::time::sleep(Duration::from_secs(secs)).await;
    }
}

async fn hello() -> Result<(), ApiError> {
    run_blocking(CONNECT_TIMEOUT, || {
        Client::default_socket()
            .with_timeout(CONNECT_TIMEOUT)
            .hello()
            .map(|_| ())
    })
    .await
}

/// `$DATA_DIR/var/railbox/rb23xx/firmware`
#[must_use]
pub fn firmware_dir(data_dir: &DataDir) -> PathBuf {
    data_dir.join(["var", "railbox", "rb23xx", "firmware"])
}

/// List `*.bin` files in `dir`. Missing directory → empty list.
pub fn list_bins(dir: &Path) -> Result<Vec<FirmwareFile>, ApiError> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => {
            return Err(ApiError::internal("firmware_dir_unreadable").with_detail(err.to_string()))
        }
    };
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|err| {
            ApiError::internal("firmware_dir_unreadable").with_detail(err.to_string())
        })?;
        let path = entry.path();
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !name.ends_with(".bin") {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) if m.is_file() => m,
            _ => continue,
        };
        if path.parent() != Some(dir) {
            continue;
        }
        files.push(FirmwareFile {
            name: name.to_string(),
            size: meta.len(),
            mtime: mtime_unix(&meta),
        });
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

/// Join `name` under `dir`. Rejects `..`, `/`, and anything that is not `*.bin`.
pub fn resolve_bin(dir: &Path, name: &str) -> Result<PathBuf, ApiError> {
    if name.is_empty() || name.contains('\0') {
        return Err(ApiError::bad_request(CODE_INVALID_FIRMWARE_FILE));
    }
    let rel = Path::new(name);
    if rel.components().count() != 1 {
        return Err(ApiError::bad_request(CODE_INVALID_FIRMWARE_FILE));
    }
    if rel.file_name().and_then(|n| n.to_str()) != Some(name) {
        return Err(ApiError::bad_request(CODE_INVALID_FIRMWARE_FILE));
    }
    if !name.ends_with(".bin") {
        return Err(ApiError::bad_request(CODE_INVALID_FIRMWARE_FILE));
    }
    let path = dir.join(name);
    if path.parent() != Some(dir) {
        return Err(ApiError::bad_request(CODE_INVALID_FIRMWARE_FILE));
    }
    match std::fs::metadata(&path) {
        Ok(meta) if meta.is_file() => Ok(path),
        Ok(_) => Err(ApiError::bad_request(CODE_INVALID_FIRMWARE_FILE)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Err(ApiError::not_found()),
        Err(err) => {
            Err(ApiError::internal("firmware_file_unreadable").with_detail(err.to_string()))
        }
    }
}

pub async fn scan_rb23xx() -> Result<Vec<FirmwareCandidate>, ApiError> {
    let found = run_blocking(SCAN_TIMEOUT, || {
        Client::default_socket()
            .with_timeout(SCAN_TIMEOUT)
            .scan_mode(ReachMode::Ap)
    })
    .await?;
    Ok(found
        .into_iter()
        .filter(|c| c.driver == RB23XX_DRIVER)
        .map(|c| FirmwareCandidate {
            key: c.key,
            label: c.label,
            rssi: c.rssi,
            driver: c.driver,
        })
        .collect())
}

pub async fn update_firmware(key: &str, path: &Path) -> Result<String, ApiError> {
    let key = key.to_string();
    let path = path.display().to_string();
    let result = run_blocking(UPDATE_TIMEOUT, move || {
        Client::default_socket()
            .with_timeout(UPDATE_TIMEOUT)
            .update_firmware(
                ReachMode::Ap,
                Some(CandidateRef {
                    driver: RB23XX_DRIVER.into(),
                    key,
                }),
                path,
                None,
                None,
                None,
            )
    })
    .await?;
    Ok(result.job_id)
}

pub async fn cancel_job(job_id: String) -> Result<(), ApiError> {
    run_blocking(CONNECT_TIMEOUT, move || {
        Client::default_socket()
            .with_timeout(CONNECT_TIMEOUT)
            .job_cancel(job_id)
            .map(|_| ())
    })
    .await
}

/// Stream `job.watch` frames until the job is terminal. Blocking reads run off
/// the runtime; `on_frame` is invoked from that thread via `blocking_send`.
pub fn watch_job(
    job_id: String,
    tx: tokio::sync::mpsc::Sender<pc_proto::FirmwareProgress>,
) -> Result<(), ApiError> {
    let client = Client::default_socket().with_timeout(WATCH_IDLE);
    let stream = client.job_watch(job_id).map_err(map_wp)?;
    stream
        .drain_with(|frame| {
            let progress = pc_proto::FirmwareProgress {
                job_id: frame.job_id.clone(),
                state: frame.state.as_str().to_string(),
                step: frame.step.clone(),
                progress: frame.progress,
                detail: frame.detail.clone(),
            };
            let _ = tx.blocking_send(progress);
        })
        .map_err(map_wp)?;
    Ok(())
}

fn mtime_unix(meta: &std::fs::Metadata) -> Option<i64> {
    let modified = meta.modified().ok()?;
    Some(
        modified
            .duration_since(UNIX_EPOCH)
            .ok()
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
    )
}

async fn run_blocking<T, F>(wait: Duration, f: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, ClientError> + Send + 'static,
{
    match timeout(wait, tokio::task::spawn_blocking(f)).await {
        Ok(Ok(Ok(v))) => Ok(v),
        Ok(Ok(Err(err))) => Err(map_wp(err)),
        Ok(Err(err)) => Err(ApiError::internal("wp_join").with_detail(err.to_string())),
        Err(_) => Err(ApiError::unavailable(CODE_WP_UNAVAILABLE).with_detail("ipc timeout")),
    }
}

pub fn map_wp(err: ClientError) -> ApiError {
    match &err {
        ClientError::Connect { .. } => {
            ApiError::unavailable(CODE_WP_UNAVAILABLE).with_detail(err.to_string())
        }
        ClientError::Busy { message } => {
            ApiError::unavailable("busy").with_public_detail(message.clone())
        }
        ClientError::NotFound { message } => {
            ApiError::not_found().with_public_detail(message.clone())
        }
        ClientError::NoCandidates { message } => {
            ApiError::unavailable("no_candidates").with_public_detail(message.clone())
        }
        ClientError::WatchIdle { .. } => {
            ApiError::unavailable("programming_timeout").with_detail(err.to_string())
        }
        ClientError::Server { code, message } => {
            ApiError::unavailable(code.clone()).with_public_detail(message.clone())
        }
        ClientError::Frame(_) | ClientError::UnexpectedResponse(_) => {
            ApiError::unavailable(CODE_WP_UNAVAILABLE).with_detail(err.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn list_bins_only_bin_files() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("ok.bin"), b"abc").unwrap();
        fs::write(tmp.path().join("notes.txt"), b"no").unwrap();
        fs::create_dir(tmp.path().join("subdir.bin")).unwrap();
        let list = list_bins(tmp.path()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "ok.bin");
        assert_eq!(list[0].size, 3);
        assert!(list[0].mtime.is_some());
    }

    #[test]
    fn list_bins_missing_dir_is_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let list = list_bins(&tmp.path().join("missing")).unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn resolve_bin_rejects_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("ok.bin"), b"x").unwrap();
        assert!(resolve_bin(tmp.path(), "../ok.bin").is_err());
        assert!(resolve_bin(tmp.path(), "/tmp/ok.bin").is_err());
        assert!(resolve_bin(tmp.path(), "ok.bin/../ok.bin").is_err());
        assert!(resolve_bin(tmp.path(), "notes.txt").is_err());
        assert!(resolve_bin(tmp.path(), "").is_err());
        let path = resolve_bin(tmp.path(), "ok.bin").unwrap();
        assert_eq!(path.file_name().unwrap(), "ok.bin");
    }

    #[test]
    fn resolve_bin_missing_is_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let err = resolve_bin(tmp.path(), "missing.bin").unwrap_err();
        assert_eq!(err.code, "not_found");
    }

    #[test]
    fn firmware_dir_joins_under_data() {
        let data = DataDir::from_path("/data");
        assert_eq!(
            firmware_dir(&data),
            PathBuf::from("/data/var/railbox/rb23xx/firmware")
        );
    }
}
