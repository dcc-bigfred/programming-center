//! Closed set of CV transports: dcc-bus or Z21 UDP.

mod dcc_bus;
mod z21;
mod z21_udp;

use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::RwLock;

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use pc_core::{CvBatch, CvEntry, Track};
use pc_proto::CvProgress;

use crate::config::{Config, IntegrationMode};
use crate::error::ApiError;

pub use dcc_bus::DccBusProgrammer;
pub use z21::Z21Programmer;

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
    ) -> Result<CvBatch, ApiError>;

    async fn write_cvs(
        &self,
        token: Option<&str>,
        station_id: Option<u64>,
        address: u16,
        cvs: &[CvEntry],
        track: Track,
    ) -> Result<CvBatch, ApiError>;
}

/// Owns both backends; [`Hub::select`] reads live `mode`.
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

    pub async fn read_cvs(
        &self,
        mode: IntegrationMode,
        token: Option<&str>,
        station_id: Option<u64>,
        address: u16,
        cvs: &[u16],
        track: Track,
    ) -> Result<CvBatch, ApiError> {
        match mode {
            IntegrationMode::Standalone => {
                self.z21
                    .read_cvs(token, station_id, address, cvs, track)
                    .await
            }
            IntegrationMode::Bigfred => {
                self.dcc
                    .read_cvs(token, station_id, address, cvs, track)
                    .await
            }
        }
    }

    pub async fn write_cvs(
        &self,
        mode: IntegrationMode,
        token: Option<&str>,
        station_id: Option<u64>,
        address: u16,
        cvs: &[CvEntry],
        track: Track,
    ) -> Result<CvBatch, ApiError> {
        match mode {
            IntegrationMode::Standalone => {
                self.z21
                    .write_cvs(token, station_id, address, cvs, track)
                    .await
            }
            IntegrationMode::Bigfred => {
                self.dcc
                    .write_cvs(token, station_id, address, cvs, track)
                    .await
            }
        }
    }

    pub fn drop_z21(&self) {
        self.z21.invalidate();
    }

    /// Standalone only: per-CV progress on `progress`, stop on `cancel`.
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
