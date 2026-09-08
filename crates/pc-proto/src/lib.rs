//! Browser ↔ programming-center WebSocket envelope.
//!
//! Memory profile: **allocation-conscious** (JSON control plane).

#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

use pc_core::{CvEntry, Track};
use serde::{Deserialize, Serialize};

/// Same shape as BigFred dcc-bus / wizard: `{ type, id, payload }`.
#[derive(Debug, Serialize, Deserialize)]
pub struct Envelope {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ack {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cvs: Option<Vec<CvEntry>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<u16>>,
}

impl Ack {
    #[must_use]
    pub fn ok_cvs(cvs: Vec<CvEntry>) -> Self {
        Self::ok_batch(cvs, Vec::new())
    }

    #[must_use]
    pub fn ok_batch(cvs: Vec<CvEntry>, errors: Vec<u16>) -> Self {
        Self {
            ok: true,
            error: None,
            detail: None,
            cvs: Some(cvs),
            errors: if errors.is_empty() {
                None
            } else {
                Some(errors)
            },
        }
    }

    #[must_use]
    pub fn fail(code: impl Into<String>, detail: Option<String>) -> Self {
        Self {
            ok: false,
            error: Some(code.into()),
            detail,
            cvs: None,
            errors: None,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CvReadPayload {
    #[serde(default)]
    pub station_id: Option<u64>,
    #[serde(default)]
    pub address: u16,
    #[serde(default)]
    pub track: Track,
    #[serde(default)]
    pub cvs: Vec<u16>,
    #[serde(default)]
    pub from: Option<u16>,
    #[serde(default)]
    pub to: Option<u16>,
    #[serde(default)]
    pub skip_address: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CvWritePayload {
    #[serde(default)]
    pub station_id: Option<u64>,
    #[serde(default)]
    pub address: u16,
    #[serde(default)]
    pub track: Track,
    pub cvs: Vec<CvEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CvBitopPayload {
    #[serde(default)]
    pub station_id: Option<u64>,
    #[serde(default)]
    pub address: u16,
    #[serde(default)]
    pub track: Track,
    pub cv: u16,
    pub and_mask: u8,
    pub or_mask: u8,
}

pub const TYPE_CV_READ: &str = "cv.read";
pub const TYPE_CV_WRITE: &str = "cv.write";
pub const TYPE_CV_BITOP: &str = "cv.bitop";
pub const TYPE_ACK: &str = "ack";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_type_field() {
        let raw = r#"{"type":"cv.read","id":"1","payload":{"cvs":[1]}}"#;
        let env: Envelope = serde_json::from_str(raw).unwrap();
        assert_eq!(env.kind, TYPE_CV_READ);
    }
}
