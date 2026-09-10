//! `address.set`: ESU service-mode locomotive address (all decoder brands).
//!
//! Programming track only. Optional CV 28 bit 7 (RailComPlus), then CV 17 → 18
//! → CV 29 bit (long) or CV 1 → clear the bit (short). Verify after the Z21
//! leaves programming mode. No POM, no dummy CV, no power cycle.
//!
//! Z21 only: in dcc-bus (`programmingMode: bigfred`) the dispatcher rejects
//! `address.set` before reaching here (see `ws::dispatch`).
//!
//! `set` depends on a narrow [`Backend`] trait rather than the whole
//! `AppState`, so the orchestration is testable with a canned backend and
//! there is no hidden dependency on the DB / HTTP client.

use std::future::Future;
use std::time::Duration;

use tokio_util::sync::CancellationToken;

use pc_core::{
    decode_address, plan_set_writes, CvBatch, CvEntry, PlanSetWrites, Track, LONG_MAX, SETTLE,
};
use pc_proto::{
    Ack, AddressSetPayload, RevertedDetail, CODE_ADDRESS_REVERTED, CODE_CANCELLED,
    CODE_INVALID_ADDRESS, CODE_INVALID_LONG_BIT, CODE_PC_DISABLED, CODE_PROGRAMMING_FAILED,
};

use crate::bus::{Hub, Observed};
use crate::config::{Config, ProgrammingMode};
use crate::error::ApiError;

const VERIFY_WAIT: Duration = Duration::from_secs(5);

/// The slice of `AppState` that `address.set` actually needs. Implementations:
/// [`Hub`] (production) and canned backends in tests.
pub trait Backend: Send + Sync {
    #[allow(clippy::too_many_arguments)]
    fn read_cvs(
        &self,
        mode: ProgrammingMode,
        token: Option<&str>,
        station_id: Option<u64>,
        address: u16,
        cvs: &[u16],
        track: Track,
        cancel: Option<&CancellationToken>,
    ) -> impl Future<Output = Result<CvBatch, ApiError>> + Send;

    #[allow(clippy::too_many_arguments)]
    fn write_cvs(
        &self,
        mode: ProgrammingMode,
        token: Option<&str>,
        station_id: Option<u64>,
        address: u16,
        cvs: &[CvEntry],
        track: Track,
        cancel: Option<&CancellationToken>,
    ) -> impl Future<Output = Result<CvBatch, ApiError>> + Send;

    fn observe_prog(
        &self,
        mode: ProgrammingMode,
        until: Duration,
        cancel: &CancellationToken,
    ) -> impl Future<Output = Option<Observed>> + Send;
}

impl Backend for Hub {
    fn read_cvs(
        &self,
        mode: ProgrammingMode,
        token: Option<&str>,
        station_id: Option<u64>,
        address: u16,
        cvs: &[u16],
        track: Track,
        cancel: Option<&CancellationToken>,
    ) -> impl Future<Output = Result<CvBatch, ApiError>> + Send {
        Hub::read_cvs(self, mode, token, station_id, address, cvs, track, cancel)
    }

    fn write_cvs(
        &self,
        mode: ProgrammingMode,
        token: Option<&str>,
        station_id: Option<u64>,
        address: u16,
        cvs: &[CvEntry],
        track: Track,
        cancel: Option<&CancellationToken>,
    ) -> impl Future<Output = Result<CvBatch, ApiError>> + Send {
        Hub::write_cvs(self, mode, token, station_id, address, cvs, track, cancel)
    }

    fn observe_prog(
        &self,
        mode: ProgrammingMode,
        until: Duration,
        cancel: &CancellationToken,
    ) -> impl Future<Output = Option<Observed>> + Send {
        Hub::observe_prog(self, mode, until, cancel)
    }
}

pub async fn set(
    cfg: &Config,
    backend: &impl Backend,
    token: Option<&str>,
    p: AddressSetPayload,
    cancel: &CancellationToken,
) -> Ack {
    if !cfg.enabled {
        return Ack::fail(CODE_PC_DISABLED, None);
    }
    if !(1..=LONG_MAX).contains(&p.new_address) {
        return Ack::fail(CODE_INVALID_ADDRESS, None);
    }
    if p.long_bit > 7 {
        return Ack::fail(CODE_INVALID_LONG_BIT, None);
    }
    let mode = cfg.cv_bus();

    let (cv28, cv29) = match read_cv28_cv29(backend, token, &p, mode, cancel).await {
        Ok(v) => v,
        Err(ack) => return ack,
    };
    let writes = match plan_set_writes(p.new_address, cv29, p.long_bit, cv28, p.railcom_plus) {
        Ok(PlanSetWrites::Ok(w)) => w,
        Ok(PlanSetWrites::SkippedRailcomPlus { want, writes }) => {
            tracing::warn!(
                railcom_plus = want,
                "CV28 not read, skipping RailComPlus write"
            );
            writes
        }
        Err(pc_core::AddressError::InvalidAddress) => return Ack::fail(CODE_INVALID_ADDRESS, None),
        Err(pc_core::AddressError::InvalidLongBit) => {
            return Ack::fail(CODE_INVALID_LONG_BIT, None)
        }
    };

    if let Err(ack) = settle(cancel).await {
        return ack;
    }

    for (i, entry) in writes.iter().copied().enumerate() {
        if i > 0 {
            if let Err(ack) = settle(cancel).await {
                return ack;
            }
        }
        if let Err(ack) = write_one(backend, token, &p, mode, entry, cancel).await {
            return ack;
        }
    }

    let observed = backend.observe_prog(mode, VERIFY_WAIT, cancel).await;
    if cancel.is_cancelled() {
        return Ack::fail(CODE_CANCELLED, None);
    }

    let outcome = verify(backend, token, &p, mode, observed.as_ref(), cancel).await;
    outcome.into_ack()
}

async fn settle(cancel: &CancellationToken) -> Result<(), Ack> {
    tokio::select! {
        () = cancel.cancelled() => Err(Ack::fail(CODE_CANCELLED, None)),
        () = tokio::time::sleep(SETTLE) => Ok(()),
    }
}

async fn read_cv28_cv29(
    backend: &impl Backend,
    token: Option<&str>,
    p: &AddressSetPayload,
    mode: ProgrammingMode,
    cancel: &CancellationToken,
) -> Result<(Option<u8>, u8), Ack> {
    let want_cv28 = p.railcom_plus.is_some();
    let cvs: &[u16] = if want_cv28 { &[28, 29] } else { &[29] };
    let batch = read_named(backend, token, p, mode, cvs, cancel).await?;
    let cv29 = match batch.iter().find(|e| e.cv == 29) {
        Some(e) => e.value,
        None => {
            tracing::warn!("CV29 not read, aborting address.set");
            return Err(Ack::fail(
                CODE_PROGRAMMING_FAILED,
                Some("CV29 not read".into()),
            ));
        }
    };
    let cv28 = batch.iter().find(|e| e.cv == 28).map(|e| e.value);
    Ok((cv28, cv29))
}

/// Domain result of the verify phase, decoupled from the wire `Ack`.
enum VerifyOutcome {
    Ok(Vec<CvEntry>),
    Reverted {
        cv29: u8,
        railcom: Vec<u16>,
        prog_current_ma: Option<i16>,
        batch: Vec<CvEntry>,
    },
    Failed {
        detail: String,
        batch: Vec<CvEntry>,
    },
}

impl VerifyOutcome {
    fn into_ack(self) -> Ack {
        match self {
            VerifyOutcome::Ok(cvs) => Ack::ok_cvs(cvs),
            VerifyOutcome::Reverted {
                cv29,
                railcom,
                prog_current_ma,
                batch,
            } => {
                tracing::warn!(
                    cv29,
                    railcom = ?railcom,
                    prog_current_ma = ?prog_current_ma,
                    "address.set reverted"
                );
                Ack::fail_reverted(
                    RevertedDetail {
                        cv29,
                        railcom,
                        prog_current_ma,
                    },
                    batch,
                )
            }
            VerifyOutcome::Failed { detail, batch } => {
                Ack::fail_cvs(CODE_ADDRESS_REVERTED, Some(detail), batch)
            }
        }
    }
}

async fn verify(
    backend: &impl Backend,
    token: Option<&str>,
    p: &AddressSetPayload,
    mode: ProgrammingMode,
    observed: Option<&Observed>,
    cancel: &CancellationToken,
) -> VerifyOutcome {
    let batch = match read_named(backend, token, p, mode, &[1, 17, 18, 29], cancel).await {
        Ok(b) => b,
        Err(ack) => {
            return VerifyOutcome::Failed {
                detail: ack.detail.unwrap_or_else(|| "read failed".into()),
                batch: Vec::new(),
            }
        }
    };
    verify_from_batch(&batch, p.new_address, p.long_bit, observed)
}

fn verify_from_batch(
    batch: &[CvEntry],
    new_address: u16,
    long_bit: u8,
    observed: Option<&Observed>,
) -> VerifyOutcome {
    let Some(cv1) = value(batch, 1) else {
        return missing_cv(1, batch);
    };
    let Some(cv17) = value(batch, 17) else {
        return missing_cv(17, batch);
    };
    let Some(cv18) = value(batch, 18) else {
        return missing_cv(18, batch);
    };
    let Some(cv29) = value(batch, 29) else {
        return missing_cv(29, batch);
    };
    let (actual, _) = decode_address(cv1, cv17, cv18, cv29, long_bit);
    if actual == new_address {
        tracing::info!(wanted = new_address, actual, cv29, "address.set verified");
        VerifyOutcome::Ok(batch.to_vec())
    } else {
        VerifyOutcome::Reverted {
            cv29,
            railcom: observed
                .map(|o| o.railcom.iter().copied().collect())
                .unwrap_or_default(),
            prog_current_ma: observed.and_then(|o| o.prog_current_ma),
            batch: batch.to_vec(),
        }
    }
}

fn missing_cv(cv: u16, batch: &[CvEntry]) -> VerifyOutcome {
    VerifyOutcome::Failed {
        detail: format!("CV{cv} not read"),
        batch: batch.to_vec(),
    }
}

fn value(cvs: &[CvEntry], cv: u16) -> Option<u8> {
    cvs.iter().find(|e| e.cv == cv).map(|e| e.value)
}

async fn read_named(
    backend: &impl Backend,
    token: Option<&str>,
    p: &AddressSetPayload,
    mode: ProgrammingMode,
    cvs: &[u16],
    cancel: &CancellationToken,
) -> Result<Vec<CvEntry>, Ack> {
    let batch = match backend
        .read_cvs(
            mode,
            token,
            p.station_id,
            p.address,
            cvs,
            Track::Prog,
            Some(cancel),
        )
        .await
    {
        Ok(b) => b,
        Err(e) => return Err(map_bus(e)),
    };
    if cancel.is_cancelled() {
        return Err(Ack::fail(CODE_CANCELLED, None));
    }
    Ok(batch.cvs)
}

async fn write_one(
    backend: &impl Backend,
    token: Option<&str>,
    p: &AddressSetPayload,
    mode: ProgrammingMode,
    entry: CvEntry,
    cancel: &CancellationToken,
) -> Result<CvEntry, Ack> {
    if cancel.is_cancelled() {
        return Err(Ack::fail(CODE_CANCELLED, None));
    }
    match backend
        .write_cvs(
            mode,
            token,
            p.station_id,
            p.address,
            &[entry],
            Track::Prog,
            Some(cancel),
        )
        .await
    {
        Ok(batch)
            if !batch.errors.contains(&entry.cv) && batch.cvs.iter().any(|e| e.cv == entry.cv) =>
        {
            Ok(entry)
        }
        Ok(_) => Err(Ack::fail(
            CODE_PROGRAMMING_FAILED,
            Some(format!("CV{} not written", entry.cv)),
        )),
        Err(e) => Err(map_bus(e)),
    }
}

fn map_bus(err: ApiError) -> Ack {
    err.into_ack()
}

#[cfg(test)]
mod tests {
    use pc_core::{plan_address_writes, CV29_LONG_BIT, RAILCOM_PLUS_CV};

    use super::*;

    fn addr_cvs(cv1: u8, cv17: u8, cv18: u8, cv29: u8) -> Vec<CvEntry> {
        vec![
            CvEntry { cv: 1, value: cv1 },
            CvEntry {
                cv: 17,
                value: cv17,
            },
            CvEntry {
                cv: 18,
                value: cv18,
            },
            CvEntry {
                cv: 29,
                value: cv29,
            },
        ]
    }

    #[test]
    fn esu_long_sequence_is_17_18_29() {
        let cvs: Vec<u16> = plan_address_writes(9728, 30, CV29_LONG_BIT)
            .unwrap()
            .into_iter()
            .map(|e| e.cv)
            .collect();
        assert_eq!(cvs, vec![17, 18, 29]);
    }

    #[test]
    fn verify_ok_when_decoder_matches() {
        let outcome = verify_from_batch(&addr_cvs(13, 200, 90, 62), 2138, CV29_LONG_BIT, None);
        let ack = outcome.into_ack();
        assert!(ack.ok);
        assert_eq!(ack.cvs.as_ref().map(|c| c.len()), Some(4));
    }

    #[test]
    fn verify_reverted_when_cv29_clears_long_bit() {
        let outcome = verify_from_batch(&addr_cvs(13, 200, 90, 30), 2138, CV29_LONG_BIT, None);
        let ack = outcome.into_ack();
        assert!(!ack.ok);
        assert_eq!(ack.error.as_deref(), Some(CODE_ADDRESS_REVERTED));
        assert!(ack.reverted.is_some());
        assert_eq!(ack.reverted.as_ref().unwrap().cv29, 30);
        assert!(ack.reverted.as_ref().unwrap().railcom.is_empty());
    }

    #[test]
    fn verify_reverted_when_cv_missing() {
        let outcome = verify_from_batch(&[CvEntry { cv: 1, value: 13 }], 2138, CV29_LONG_BIT, None);
        let ack = outcome.into_ack();
        assert!(!ack.ok);
        assert_eq!(ack.error.as_deref(), Some(CODE_ADDRESS_REVERTED));
        assert_eq!(ack.detail.as_deref(), Some("CV17 not read"));
        assert_eq!(ack.cvs.as_ref().map(|c| c.len()), Some(1));
    }

    #[test]
    fn verify_reverted_includes_railcom_addrs() {
        let mut railcom = heapless::Vec::new();
        railcom.push(13).unwrap();
        let observed = Observed {
            railcom,
            prog_current_ma: Some(42),
            ..Observed::default()
        };
        let outcome = verify_from_batch(
            &addr_cvs(13, 200, 90, 30),
            2138,
            CV29_LONG_BIT,
            Some(&observed),
        );
        let ack = outcome.into_ack();
        let rev = ack.reverted.expect("reverted detail");
        assert_eq!(rev.cv29, 30);
        assert_eq!(rev.railcom, vec![13]);
        assert_eq!(rev.prog_current_ma, Some(42));
    }

    // --- Integration tests for the `set` orchestration with a canned backend ---

    use std::sync::Mutex;

    /// Canned [`Backend`] that returns programmed reads/writes and an optional
    /// `Observed`. Exercises the full `set` flow (settle, plan, write loop,
    /// observe, verify) without UDP.
    struct MockBackend {
        /// First reads (CV 28/29 pre-write).
        pre_read: Mutex<Vec<CvEntry>>,
        /// Writes accepted by the backend, recorded in order.
        writes: Mutex<Vec<CvEntry>>,
        /// CVs returned by the post-write verify read (1/17/18/29).
        verify_read: Mutex<Vec<CvEntry>>,
        /// What `observe_prog` returns.
        observed: Option<Observed>,
    }

    impl MockBackend {
        fn new() -> Self {
            Self {
                pre_read: Mutex::new(Vec::new()),
                writes: Mutex::new(Vec::new()),
                verify_read: Mutex::new(Vec::new()),
                observed: None,
            }
        }
    }

    impl Backend for MockBackend {
        fn read_cvs(
            &self,
            _mode: ProgrammingMode,
            _token: Option<&str>,
            _station_id: Option<u64>,
            _address: u16,
            cvs: &[u16],
            _track: Track,
            _cancel: Option<&CancellationToken>,
        ) -> impl Future<Output = Result<CvBatch, ApiError>> + Send {
            let want: Vec<u16> = cvs.to_vec();
            async move {
                // Pre-read asks for CV 28 and/or CV 29 only; verify asks for
                // CV 1/17/18/29. Route by whether CV 1 is requested.
                let source = if want.contains(&1) {
                    &self.verify_read
                } else {
                    &self.pre_read
                };
                let guard = source.lock().unwrap();
                let entries: Vec<CvEntry> = guard
                    .iter()
                    .filter(|e| want.contains(&e.cv))
                    .copied()
                    .collect();
                Ok(CvBatch {
                    cvs: entries,
                    errors: Vec::new(),
                })
            }
        }

        fn write_cvs(
            &self,
            _mode: ProgrammingMode,
            _token: Option<&str>,
            _station_id: Option<u64>,
            _address: u16,
            cvs: &[CvEntry],
            _track: Track,
            _cancel: Option<&CancellationToken>,
        ) -> impl Future<Output = Result<CvBatch, ApiError>> + Send {
            let entries: Vec<CvEntry> = cvs.to_vec();
            async move {
                let mut w = self.writes.lock().unwrap();
                w.extend(entries.iter().copied());
                Ok(CvBatch {
                    cvs: entries,
                    errors: Vec::new(),
                })
            }
        }

        fn observe_prog(
            &self,
            _mode: ProgrammingMode,
            _until: Duration,
            _cancel: &CancellationToken,
        ) -> impl Future<Output = Option<Observed>> + Send {
            let observed = self.observed.clone();
            async move { observed }
        }
    }

    fn z21_cfg() -> Config {
        Config {
            programming_mode: ProgrammingMode::Z21,
            enabled: true,
            ..Config::default()
        }
    }

    #[tokio::test]
    async fn set_long_address_succeeds_when_decoder_matches() {
        let backend = MockBackend::new();
        *backend.pre_read.lock().unwrap() = vec![CvEntry { cv: 29, value: 30 }];
        *backend.verify_read.lock().unwrap() = addr_cvs(13, 200, 90, 62);
        let cfg = z21_cfg();
        let cancel = CancellationToken::new();
        let p = AddressSetPayload {
            station_id: None,
            address: 13,
            new_address: 2138,
            long_bit: CV29_LONG_BIT,
            railcom_plus: None,
        };
        let ack = set(&cfg, &backend, None, p, &cancel).await;
        assert!(ack.ok);
        let written: Vec<u16> = backend
            .writes
            .lock()
            .unwrap()
            .iter()
            .map(|e| e.cv)
            .collect();
        assert_eq!(written, vec![17, 18, 29]);
    }

    #[tokio::test]
    async fn set_returns_address_reverted_when_cv29_clears_long_bit() {
        let backend = MockBackend::new();
        *backend.pre_read.lock().unwrap() = vec![CvEntry { cv: 29, value: 30 }];
        // Decoder reverted: CV 29 long bit cleared (30 instead of 62).
        *backend.verify_read.lock().unwrap() = addr_cvs(13, 200, 90, 30);
        let cfg = z21_cfg();
        let cancel = CancellationToken::new();
        let p = AddressSetPayload {
            station_id: None,
            address: 13,
            new_address: 2138,
            long_bit: CV29_LONG_BIT,
            railcom_plus: None,
        };
        let ack = set(&cfg, &backend, None, p, &cancel).await;
        assert!(!ack.ok);
        assert_eq!(ack.error.as_deref(), Some(CODE_ADDRESS_REVERTED));
        let rev = ack.reverted.expect("reverted detail");
        assert_eq!(rev.cv29, 30);
    }

    #[tokio::test]
    async fn set_writes_cv28_first_when_railcom_plus_toggled() {
        let backend = MockBackend::new();
        *backend.pre_read.lock().unwrap() = vec![
            CvEntry { cv: 28, value: 131 },
            CvEntry { cv: 29, value: 30 },
        ];
        *backend.verify_read.lock().unwrap() = addr_cvs(13, 200, 90, 62);
        let cfg = z21_cfg();
        let cancel = CancellationToken::new();
        let p = AddressSetPayload {
            station_id: None,
            address: 13,
            new_address: 2138,
            long_bit: CV29_LONG_BIT,
            railcom_plus: Some(false),
        };
        let ack = set(&cfg, &backend, None, p, &cancel).await;
        assert!(ack.ok);
        let written: Vec<u16> = backend
            .writes
            .lock()
            .unwrap()
            .iter()
            .map(|e| e.cv)
            .collect();
        assert_eq!(written, vec![RAILCOM_PLUS_CV, 17, 18, 29]);
    }

    #[tokio::test]
    async fn set_rejects_invalid_address() {
        let backend = MockBackend::new();
        let cfg = z21_cfg();
        let cancel = CancellationToken::new();
        let p = AddressSetPayload {
            station_id: None,
            address: 13,
            new_address: 0,
            long_bit: CV29_LONG_BIT,
            railcom_plus: None,
        };
        let ack = set(&cfg, &backend, None, p, &cancel).await;
        assert!(!ack.ok);
        assert_eq!(ack.error.as_deref(), Some(CODE_INVALID_ADDRESS));
    }
}
