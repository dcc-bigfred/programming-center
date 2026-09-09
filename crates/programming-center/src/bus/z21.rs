//! Direct UDP programming against a Z21 / RailBOX.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio_util::sync::CancellationToken;

use pc_core::{CvBatch, CvEntry, Track};
use pc_proto::CvProgress;

use crate::config::Config;
use crate::error::ApiError;

use super::z21_udp::{CvError, Observed, Z21Client};
use super::ProgrammingBus;

const SETTLE: Duration = Duration::from_millis(300);

struct InnerReport<'a> {
    cancel: Option<&'a CancellationToken>,
    progress: Option<&'a mpsc::Sender<CvProgress>>,
    done_base: u32,
    total: u32,
}

#[derive(Clone)]
struct Session {
    host: String,
    port: u16,
    client: Arc<Z21Client>,
    generation: u64,
}

pub struct Z21Programmer {
    cfg: Arc<RwLock<Config>>,
    inner: Mutex<Option<Session>>,
    generation: AtomicU64,
}

impl Z21Programmer {
    pub fn new(cfg: Arc<RwLock<Config>>) -> Self {
        Self {
            cfg,
            inner: Mutex::new(None),
            generation: AtomicU64::new(1),
        }
    }

    pub fn invalidate(&self) {
        self.generation.fetch_add(1, Ordering::Release);
    }

    async fn session(&self, cancel: Option<&CancellationToken>) -> Result<Session, ApiError> {
        let lock = self.inner.lock();
        let mut guard = if let Some(token) = cancel {
            tokio::select! {
                () = token.cancelled() => return Err(ApiError::cancelled()),
                g = lock => g,
            }
        } else {
            lock.await
        };
        let cfg = self.cfg.read().await;
        let z21 = cfg.z21.clone();
        drop(cfg);
        if !z21.is_configured() {
            tracing::warn!("z21 hostname/port missing");
            return Err(ApiError::unavailable("z21_not_configured")
                .with_detail("z21.hostname and z21.port are required when programmingMode is z21"));
        }
        let host = z21.hostname.trim().to_string();
        let gen = self.generation.load(Ordering::Acquire);
        let stale = match guard.as_ref() {
            Some(s) => s.host != host || s.port != z21.port || s.generation != gen,
            None => true,
        };
        if stale {
            let addr = z21.socket_addr().map_err(|err| {
                tracing::warn!(host = %host, port = z21.port, error = %err, "z21 address resolve failed");
                ApiError::bad_request("invalid_z21_address").with_public_detail(err)
            })?;
            tracing::info!(host = %host, port = z21.port, %addr, "z21 opening session");
            let client = Z21Client::connect(addr).await.map_err(map_unreachable)?;
            *guard = Some(Session {
                host,
                port: z21.port,
                client: Arc::new(client),
                generation: gen,
            });
        }
        guard
            .as_ref()
            .cloned()
            .ok_or_else(|| ApiError::unavailable("z21_unreachable"))
    }

    /// Read CVs one-by-one, reporting before and after each slot. Stops between
    /// CVs (and during settle) when `cancel` is cancelled.
    pub async fn read_cvs_reporting(
        &self,
        address: u16,
        cvs: &[u16],
        track: Track,
        cancel: &CancellationToken,
        report: super::CvReadReport,
    ) -> Result<CvBatch, ApiError> {
        self.read_loop(
            address,
            cvs,
            track,
            InnerReport {
                cancel: Some(cancel),
                progress: Some(&report.progress),
                done_base: report.done_base,
                total: report.total,
            },
        )
        .await
    }

    async fn read_loop(
        &self,
        address: u16,
        cvs: &[u16],
        track: Track,
        report: InnerReport<'_>,
    ) -> Result<CvBatch, ApiError> {
        let session = self.session(report.cancel).await?;
        let pom = track.is_pom();
        let mut out = CvBatch::default();
        let mut drop_session: Option<ApiError> = None;
        let mut timeouts = 0u8;
        let client = &session.client;
        for (i, cv) in cvs.iter().copied().enumerate() {
            if report.cancel.is_some_and(CancellationToken::is_cancelled) {
                return Err(ApiError::cancelled());
            }
            if session.generation != self.generation.load(Ordering::Acquire) {
                return Err(ApiError::unavailable("z21_session_replaced"));
            }
            if !pc_core::valid_cv(cv) {
                return Err(ApiError::bad_request("invalid_cv"));
            }
            if i > 0 {
                if let Some(token) = report.cancel {
                    tokio::select! {
                        () = token.cancelled() => return Err(ApiError::cancelled()),
                        () = tokio::time::sleep(SETTLE) => {}
                    }
                } else {
                    tokio::time::sleep(SETTLE).await;
                }
            }
            if report.cancel.is_some_and(CancellationToken::is_cancelled) {
                return Err(ApiError::cancelled());
            }
            let done = report
                .done_base
                .saturating_add(u32::try_from(i).unwrap_or(u32::MAX));
            if let Some(tx) = report.progress {
                match tx.try_send(CvProgress::reading(cv, done, report.total)) {
                    Err(mpsc::error::TrySendError::Closed(_)) => {
                        return Err(ApiError::cancelled());
                    }
                    Err(mpsc::error::TrySendError::Full(_)) | Ok(()) => {}
                }
            }
            let result = if pom {
                client.read_cv_pom(address, cv, report.cancel).await
            } else {
                client.read_cv(cv, report.cancel).await
            };
            let done = report
                .done_base
                .saturating_add(u32::try_from(i + 1).unwrap_or(u32::MAX));
            match result {
                Ok(value) => {
                    timeouts = 0;
                    if let Some(tx) = report.progress {
                        match tx.try_send(CvProgress::got(cv, value, done, report.total)) {
                            Err(mpsc::error::TrySendError::Closed(_)) => {
                                return Err(ApiError::cancelled());
                            }
                            Err(mpsc::error::TrySendError::Full(_)) | Ok(()) => {}
                        }
                    }
                    out.cvs.push(CvEntry { cv, value });
                }
                Err(err) => {
                    if let Some(tx) = report.progress {
                        let _ = tx.try_send(CvProgress::failed(cv, done, report.total));
                    }
                    match classify_cv_err(cv, err, &mut timeouts, &mut out) {
                        Ok(()) => {}
                        Err(api) => {
                            drop_session = Some(api);
                            break;
                        }
                    }
                }
            }
        }
        if let Some(api) = drop_session {
            let mut guard = self.inner.lock().await;
            *guard = None;
            return Err(api);
        }
        Ok(out)
    }

    /// Wait until the Z21 leaves programming mode (or `until` elapses).
    pub async fn observe(
        &self,
        until: Duration,
        cancel: Option<&CancellationToken>,
    ) -> Result<Observed, ApiError> {
        let session = self.session(cancel).await?;
        session
            .client
            .observe(until, cancel)
            .await
            .map_err(|err| match err {
                CvError::Cancelled => ApiError::cancelled(),
                other => map_unreachable(other),
            })
    }
}

fn map_unreachable(err: CvError) -> ApiError {
    tracing::warn!(error = %err, "z21 unreachable");
    ApiError::unavailable("z21_unreachable").with_detail(err.to_string())
}

fn classify_cv_err(
    cv: u16,
    err: CvError,
    timeouts: &mut u8,
    out: &mut CvBatch,
) -> Result<(), ApiError> {
    match err {
        CvError::Nack => {
            *timeouts = 0;
            tracing::info!(cv, error = %err, "z21 cv failed");
            out.errors.push(cv);
            Ok(())
        }
        CvError::Cancelled => Err(ApiError::cancelled()),
        CvError::ShortCircuit => {
            tracing::warn!(cv, "z21 programming-track short — aborting batch");
            Err(ApiError::unavailable("short_circuit"))
        }
        CvError::Timeout(_) => {
            tracing::info!(cv, error = %err, "z21 cv failed");
            out.errors.push(cv);
            *timeouts = timeouts.saturating_add(1);
            if *timeouts >= 2 {
                Err(ApiError::unavailable("z21_unreachable"))
            } else {
                Ok(())
            }
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
        cancel: Option<&CancellationToken>,
    ) -> Result<CvBatch, ApiError> {
        let total = u32::try_from(cvs.len()).unwrap_or(u32::MAX);
        self.read_loop(
            address,
            cvs,
            track,
            InnerReport {
                cancel,
                progress: None,
                done_base: 0,
                total,
            },
        )
        .await
    }

    async fn write_cvs(
        &self,
        _token: Option<&str>,
        _station_id: Option<u64>,
        address: u16,
        cvs: &[CvEntry],
        track: Track,
        cancel: Option<&CancellationToken>,
    ) -> Result<CvBatch, ApiError> {
        let session = self.session(cancel).await?;
        let pom = track.is_pom();
        let mut out = CvBatch::default();
        let mut drop_session: Option<ApiError> = None;
        let mut timeouts = 0u8;
        let client = &session.client;
        for (i, entry) in cvs.iter().enumerate() {
            if cancel.is_some_and(CancellationToken::is_cancelled) {
                return Err(ApiError::cancelled());
            }
            if session.generation != self.generation.load(Ordering::Acquire) {
                return Err(ApiError::unavailable("z21_session_replaced"));
            }
            if !pc_core::valid_cv(entry.cv) {
                return Err(ApiError::bad_request("invalid_cv"));
            }
            if i > 0 {
                if let Some(token) = cancel {
                    tokio::select! {
                        () = token.cancelled() => return Err(ApiError::cancelled()),
                        () = tokio::time::sleep(SETTLE) => {}
                    }
                } else {
                    tokio::time::sleep(SETTLE).await;
                }
            }
            let result = if pom {
                client
                    .write_cv_pom(address, entry.cv, entry.value, cancel)
                    .await
                    .map(|_| entry.value)
            } else {
                client.write_cv(entry.cv, entry.value, cancel).await
            };
            match result {
                Ok(_) => {
                    timeouts = 0;
                    out.cvs.push(*entry);
                }
                Err(err) => match classify_cv_err(entry.cv, err, &mut timeouts, &mut out) {
                    Ok(()) => {}
                    Err(api) => {
                        drop_session = Some(api);
                        break;
                    }
                },
            }
        }
        if let Some(api) = drop_session {
            let mut guard = self.inner.lock().await;
            *guard = None;
            return Err(api);
        }
        Ok(out)
    }
}
