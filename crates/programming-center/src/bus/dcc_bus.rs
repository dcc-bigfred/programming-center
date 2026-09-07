//! BigFred dcc-bus adapter.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::json;

use pc_core::{CvBatch, CvEntry, Track};

use crate::error::ApiError;

use super::ProgrammingBus;

#[derive(Clone)]
pub struct DccBusProgrammer {
    client: Arc<bigfred_client::DccBusClient>,
}

impl DccBusProgrammer {
    pub fn new(client: Arc<bigfred_client::DccBusClient>) -> Self {
        Self { client }
    }
}

fn require_token(token: Option<&str>) -> Result<&str, ApiError> {
    match token {
        Some(t) if !t.is_empty() => Ok(t),
        _ => Err(ApiError::unauthorized()),
    }
}

fn require_station(station_id: Option<u64>) -> Result<u64, ApiError> {
    match station_id {
        Some(id) if id > 0 => Ok(id),
        _ => Err(ApiError::bad_request("station_required")),
    }
}

#[async_trait]
impl ProgrammingBus for DccBusProgrammer {
    async fn read_cvs(
        &self,
        token: Option<&str>,
        station_id: Option<u64>,
        address: u16,
        cvs: &[u16],
        track: Track,
    ) -> Result<CvBatch, ApiError> {
        let token = require_token(token)?;
        let station = require_station(station_id)?;
        for cv in cvs {
            if !pc_core::valid_cv(*cv) {
                return Err(ApiError::bad_request("invalid_cv"));
            }
        }
        let ack = self
            .client
            .request_to(
                token,
                station,
                "loco.cvRead",
                json!({
                    "address": address,
                    "cvs": cvs,
                    "mode": track.as_wire(),
                }),
            )
            .await?;
        Ok(batch_from_ack(&ack, &[]))
    }

    async fn write_cvs(
        &self,
        token: Option<&str>,
        station_id: Option<u64>,
        address: u16,
        cvs: &[CvEntry],
        track: Track,
    ) -> Result<CvBatch, ApiError> {
        let token = require_token(token)?;
        let station = require_station(station_id)?;
        for e in cvs {
            if !pc_core::valid_cv(e.cv) {
                return Err(ApiError::bad_request("invalid_cv"));
            }
        }
        let wire: Vec<serde_json::Value> = cvs
            .iter()
            .map(|e| json!({ "cv": e.cv, "value": e.value }))
            .collect();
        let ack = self
            .client
            .request_to(
                token,
                station,
                "loco.cvWrite",
                json!({
                    "address": address,
                    "cvs": wire,
                    "mode": track.as_wire(),
                }),
            )
            .await?;
        Ok(batch_from_ack(&ack, cvs))
    }
}

fn batch_from_ack(ack: &bigfred_client::Ack, fallback: &[CvEntry]) -> CvBatch {
    let cvs = if let Some(got) = &ack.cvs {
        got.iter()
            .map(|e| CvEntry {
                cv: e.cv,
                value: e.value,
            })
            .collect()
    } else {
        fallback.to_vec()
    };
    CvBatch {
        cvs,
        errors: ack.errors.clone().unwrap_or_default(),
    }
}
