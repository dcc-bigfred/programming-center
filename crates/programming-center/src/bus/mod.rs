//! Closed set of CV transports: dcc-bus or Z21 UDP.

mod dcc_bus;
mod z21;
mod z21_udp;

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::RwLock;

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use pc_core::{CvBatch, CvEntry, Track};
use pc_proto::CvProgress;

use crate::config::{Config, ProgrammingMode};
use crate::error::ApiError;

pub use dcc_bus::DccBusProgrammer;
pub use z21::Z21Programmer;
pub use z21_udp::{Observed, Z21RailcomSnap};

/// Standalone read: stream `CvProgress` and honour cancel between CVs.
pub struct CvReadReport {
    pub progress: mpsc::Sender<CvProgress>,
    pub done_base: u32,
    pub total: u32,
}

#[async_trait]
pub trait ProgrammingBus: Send + Sync {
    async fn read_cvs(
        &self,
        token: Option<&str>,
        station_id: Option<u64>,
        address: u16,
        cvs: &[u16],
        track: Track,
        cancel: Option<&CancellationToken>,
    ) -> Result<CvBatch, ApiError>;

    async fn write_cvs(
        &self,
        token: Option<&str>,
        station_id: Option<u64>,
        address: u16,
        cvs: &[CvEntry],
        track: Track,
        cancel: Option<&CancellationToken>,
    ) -> Result<CvBatch, ApiError>;
}

/// Owns both backends; [`Hub::adapter`] reads live `programmingMode`.
///
/// `read_cvs` / `write_cvs` dispatch through the [`ProgrammingBus`] trait so the
/// contract is shared, but selection is a static `match` (two arms) rather than
/// `Box<dyn>` — cheaper and keeps the Z21-specific methods (`observe_prog`,
/// `read_cvs_reporting`) on the concrete [`Z21Programmer`].
#[derive(Clone)]
pub struct Hub {
    dcc: DccBusProgrammer,
    z21: Arc<Z21Programmer>,
}

impl Hub {
    pub fn new(dcc: Arc<bigfred_client::DccBusClient>, cfg: Arc<RwLock<Config>>) -> Self {
        Self {
            dcc: DccBusProgrammer::new(dcc),
            z21: Arc::new(Z21Programmer::new(cfg)),
        }
    }

    fn adapter(&self, mode: ProgrammingMode) -> &dyn ProgrammingBus {
        match mode {
            ProgrammingMode::Z21 => self.z21.as_ref(),
            ProgrammingMode::Bigfred => &self.dcc,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn read_cvs(
        &self,
        mode: ProgrammingMode,
        token: Option<&str>,
        station_id: Option<u64>,
        address: u16,
        cvs: &[u16],
        track: Track,
        cancel: Option<&CancellationToken>,
    ) -> Result<CvBatch, ApiError> {
        self.adapter(mode)
            .read_cvs(token, station_id, address, cvs, track, cancel)
            .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn write_cvs(
        &self,
        mode: ProgrammingMode,
        token: Option<&str>,
        station_id: Option<u64>,
        address: u16,
        cvs: &[CvEntry],
        track: Track,
        cancel: Option<&CancellationToken>,
    ) -> Result<CvBatch, ApiError> {
        self.adapter(mode)
            .write_cvs(token, station_id, address, cvs, track, cancel)
            .await
    }

    pub fn drop_z21(&self) {
        self.z21.invalidate();
    }

    /// Z21 only: per-CV progress on `progress`, stop on `cancel`.
    pub async fn read_cvs_reporting(
        &self,
        address: u16,
        cvs: &[u16],
        track: Track,
        cancel: &CancellationToken,
        report: CvReadReport,
    ) -> Result<CvBatch, ApiError> {
        self.z21
            .read_cvs_reporting(address, cvs, track, cancel, report)
            .await
    }

    /// Z21 only: listen until the command station leaves programming mode.
    pub async fn observe_prog(
        &self,
        mode: ProgrammingMode,
        until: Duration,
        cancel: &CancellationToken,
    ) -> Option<Observed> {
        match mode {
            ProgrammingMode::Z21 => match self.z21.observe(until, Some(cancel)).await {
                Ok(got) => Some(got),
                Err(err) => {
                    tracing::debug!(code = %err.code, "z21 observe_prog failed");
                    None
                }
            },
            ProgrammingMode::Bigfred => None,
        }
    }

    /// Z21 only: stream RailCom snapshots for one locomotive.
    pub async fn watch_railcom(
        &self,
        mode: ProgrammingMode,
        addr: u16,
        cancel: &CancellationToken,
        tx: mpsc::Sender<Z21RailcomSnap>,
    ) -> Result<(), ApiError> {
        match mode {
            ProgrammingMode::Z21 => self.z21.watch_railcom(addr, cancel, tx).await,
            ProgrammingMode::Bigfred => Err(ApiError::bad_request("z21_required")),
        }
    }

    /// Ops-track locomotive function. Not part of [`ProgrammingBus`] (CV-only).
    #[allow(clippy::too_many_arguments)]
    pub async fn set_function(
        &self,
        mode: ProgrammingMode,
        token: Option<&str>,
        station_id: Option<u64>,
        address: u16,
        function: u8,
        on: bool,
        cancel: &CancellationToken,
    ) -> Result<(), ApiError> {
        match mode {
            ProgrammingMode::Z21 => {
                self.z21
                    .set_function(address, function, on, Some(cancel))
                    .await
            }
            ProgrammingMode::Bigfred => {
                self.dcc
                    .set_function(token, station_id, address, function, on, Some(cancel))
                    .await
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hub_constructs() {
        let cfg = Config::default();
        let data = crate::config::resolve_data_dir();
        let bf = Arc::new(RwLock::new(cfg.bigfred_view(&data)));
        let http = reqwest::Client::new();
        let dcc = Arc::new(bigfred_client::DccBusClient::new(bf, http));
        let _hub = Hub::new(dcc, Arc::new(RwLock::new(cfg)));
    }
}
