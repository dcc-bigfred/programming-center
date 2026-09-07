//! Direct UDP programming against a Z21 / RailBOX.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::{Mutex, RwLock};

use pc_core::{CvBatch, CvEntry, Track};

use crate::config::Config;
use crate::error::ApiError;

use super::z21_udp::{CvError, Z21Client};
use super::ProgrammingBus;

const SETTLE: Duration = Duration::from_millis(300);

pub struct Z21Programmer {
    cfg: Arc<RwLock<Config>>,
    inner: Mutex<Option<(String, u16, Z21Client)>>,
}

impl Z21Programmer {
    pub fn new(cfg: Arc<RwLock<Config>>) -> Self {
        Self {
            cfg,
            inner: Mutex::new(None),
        }
    }

    pub fn invalidate(&self) {
        if let Ok(mut g) = self.inner.try_lock() {
            *g = None;
        }
    }

    async fn ensure_inner(
        &self,
    ) -> Result<tokio::sync::MutexGuard<'_, Option<(String, u16, Z21Client)>>, ApiError> {
        let mut guard = self.inner.lock().await;
        let cfg = self.cfg.read().await;
        let z21 = cfg.z21.clone();
        drop(cfg);
        if !z21.is_configured() {
            tracing::warn!("z21 hostname/port missing in standalone config");
            return Err(ApiError::unavailable("z21_not_configured")
                .with_detail("z21.hostname and z21.port are required in standalone mode"));
        }
        let host = z21.hostname.trim().to_string();
        let stale = match guard.as_ref() {
            Some((h, p, _)) => h != host.as_str() || *p != z21.port,
            None => true,
        };
        if stale {
            let addr = z21.socket_addr().map_err(|err| {
                tracing::warn!(host = %host, port = z21.port, error = %err, "z21 address resolve failed");
                ApiError::bad_request("invalid_z21_address").with_detail(err)
            })?;
            tracing::info!(host = %host, port = z21.port, %addr, "z21 opening session");
            let client = Z21Client::connect(addr).await.map_err(map_unreachable)?;
            *guard = Some((host, z21.port, client));
        }
        Ok(guard)
    }
}

fn map_unreachable(err: CvError) -> ApiError {
    tracing::warn!(error = %err, "z21 unreachable");
    ApiError::unavailable("z21_unreachable").with_detail(err.to_string())
}

fn record_cv_err(out: &mut CvBatch, cv: u16, err: CvError) -> Result<(), ApiError> {
    match err {
        CvError::Nack | CvError::ShortCircuit | CvError::Timeout(_) => {
            tracing::info!(cv, error = %err, "z21 cv failed");
            out.errors.push(cv);
            Ok(())
        }
        CvError::Io(io) => {
            tracing::error!(cv, error = %io, "z21 udp i/o — dropping session");
            Err(map_unreachable(CvError::Io(io)))
        }
    }
}

#[async_trait]
impl ProgrammingBus for Z21Programmer {
    async fn read_cvs(
        &self,
        _token: Option<&str>,
        _station_id: Option<u64>,
        address: u16,
        cvs: &[u16],
        track: Track,
    ) -> Result<CvBatch, ApiError> {
        let mut guard = self.ensure_inner().await?;
        let pom = track.is_pom();
        let mut out = CvBatch::default();
        let mut drop_session: Option<ApiError> = None;
        {
            let client = match guard.as_ref() {
                Some((_, _, c)) => c,
                None => return Err(ApiError::unavailable("z21_unreachable")),
            };
            for (i, cv) in cvs.iter().copied().enumerate() {
                if !pc_core::valid_cv(cv) {
                    return Err(ApiError::bad_request("invalid_cv"));
                }
                if i > 0 {
                    tokio::time::sleep(SETTLE).await;
                }
                let result = if pom {
                    client.read_cv_pom(address, cv).await
                } else {
                    client.read_cv(cv).await
                };
                match result {
                    Ok(value) => out.cvs.push(CvEntry { cv, value }),
                    Err(err) => {
                        if let Err(api) = record_cv_err(&mut out, cv, err) {
                            drop_session = Some(api);
                            break;
                        }
                    }
                }
            }
        }
        if let Some(api) = drop_session {
            *guard = None;
            return Err(api);
        }
        Ok(out)
    }

    async fn write_cvs(
        &self,
        _token: Option<&str>,
        _station_id: Option<u64>,
        address: u16,
        cvs: &[CvEntry],
        track: Track,
    ) -> Result<CvBatch, ApiError> {
        let mut guard = self.ensure_inner().await?;
        let pom = track.is_pom();
        let mut out = CvBatch::default();
        let mut drop_session: Option<ApiError> = None;
        {
            let client = match guard.as_ref() {
                Some((_, _, c)) => c,
                None => return Err(ApiError::unavailable("z21_unreachable")),
            };
            for (i, entry) in cvs.iter().enumerate() {
                if !pc_core::valid_cv(entry.cv) {
                    return Err(ApiError::bad_request("invalid_cv"));
                }
                if i > 0 {
                    tokio::time::sleep(SETTLE).await;
                }
                let result = if pom {
                    client
                        .write_cv_pom(address, entry.cv, entry.value)
                        .await
                        .map(|_| entry.value)
                } else {
                    client.write_cv(entry.cv, entry.value).await
                };
                match result {
                    Ok(_) => out.cvs.push(*entry),
                    Err(err) => {
                        if let Err(api) = record_cv_err(&mut out, entry.cv, err) {
                            drop_session = Some(api);
                            break;
                        }
                    }
                }
            }
        }
        if let Some(api) = drop_session {
            *guard = None;
            return Err(api);
        }
        Ok(out)
    }
}
