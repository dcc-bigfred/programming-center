//! BigFred dcc-bus adapter.

use std::sync::Arc;

use async_trait::async_trait;
use serde_json::json;

use tokio_util::sync::CancellationToken;

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
        _ => Err(ApiError::auth_required()),
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
        cancel: Option<&CancellationToken>,
    ) -> Result<CvBatch, ApiError> {
        if cancel.is_some_and(CancellationToken::is_cancelled) {
            return Err(ApiError::cancelled());
        }
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
        cancel: Option<&CancellationToken>,
    ) -> Result<CvBatch, ApiError> {
        if cancel.is_some_and(CancellationToken::is_cancelled) {
            return Err(ApiError::cancelled());
        }
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
    let errors = ack.errors.clone().unwrap_or_default();
    let cvs = if let Some(got) = &ack.cvs {
        got.iter()
            .map(|e| CvEntry {
                cv: e.cv,
                value: e.value,
            })
            .collect()
    } else if errors.is_empty() {
        fallback.to_vec()
    } else {
        fallback
            .iter()
            .filter(|e| !errors.contains(&e.cv))
            .copied()
            .collect()
    };
    CvBatch { cvs, errors }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ack(cvs: Option<Vec<CvEntry>>, errors: Option<Vec<u16>>) -> bigfred_client::Ack {
        bigfred_client::Ack {
            ok: true,
            error: None,
            cvs: cvs.map(|list| {
                list.into_iter()
                    .map(|e| bigfred_client::CvEntry {
                        cv: e.cv,
                        value: e.value,
                    })
                    .collect()
            }),
            errors,
            loco_address: None,
            long_address: None,
        }
    }

    #[test]
    fn keeps_per_cv_errors() {
        let got = batch_from_ack(
            &ack(Some(vec![CvEntry { cv: 33, value: 4 }]), Some(vec![34])),
            &[],
        );
        assert_eq!(got.cvs, vec![CvEntry { cv: 33, value: 4 }]);
        assert_eq!(got.errors, vec![34]);
    }

    #[test]
    fn write_fallback_skips_failed_slots() {
        let fallback = [CvEntry { cv: 1, value: 3 }, CvEntry { cv: 2, value: 10 }];
        let got = batch_from_ack(&ack(None, Some(vec![2])), &fallback);
        assert_eq!(got.cvs, vec![CvEntry { cv: 1, value: 3 }]);
        assert_eq!(got.errors, vec![2]);
    }
}
