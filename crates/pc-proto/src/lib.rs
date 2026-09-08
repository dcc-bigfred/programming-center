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

/// One step of a standalone `cv.read` (same `id` as the request).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CvProgress {
    pub total: u32,
    pub done: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cv: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed: Option<bool>,
}

impl CvProgress {
    #[must_use]
    pub fn reading(current: u16, done: u32, total: u32) -> Self {
        Self {
            total,
            done,
            current: Some(current),
            cv: None,
            value: None,
            failed: None,
        }
    }

    #[must_use]
    pub fn got(cv: u16, value: u8, done: u32, total: u32) -> Self {
        Self {
            total,
            done,
            current: None,
            cv: Some(cv),
            value: Some(value),
            failed: None,
        }
    }

    #[must_use]
    pub fn failed(cv: u16, done: u32, total: u32) -> Self {
        Self {
            total,
            done,
            current: None,
            cv: Some(cv),
            value: None,
            failed: Some(true),
        }
    }
}

pub const TYPE_CV_READ: &str = "cv.read";
pub const TYPE_CV_READ_CANCEL: &str = "cv.read.cancel";
pub const TYPE_CV_PROGRESS: &str = "cv.progress";
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

    #[test]
    fn progress_reading_omits_value() {
        let p = CvProgress::reading(33, 0, 14);
        let raw = serde_json::to_value(&p).unwrap();
        assert_eq!(raw["current"], 33);
        assert_eq!(raw["done"], 0);
        assert_eq!(raw["total"], 14);
        assert!(raw.get("cv").is_none());
        assert!(raw.get("value").is_none());
        assert!(raw.get("failed").is_none());
    }

    #[test]
    fn progress_got_and_failed_round_trip() {
        let got = CvProgress::got(34, 2, 2, 14);
        let failed = CvProgress::failed(35, 3, 14);
        let got2: CvProgress = serde_json::from_value(serde_json::to_value(&got).unwrap()).unwrap();
        let failed2: CvProgress =
            serde_json::from_value(serde_json::to_value(&failed).unwrap()).unwrap();
        assert_eq!(got, got2);
        assert_eq!(failed, failed2);
        assert_eq!(TYPE_CV_PROGRESS, "cv.progress");
        assert_eq!(TYPE_CV_READ_CANCEL, "cv.read.cancel");
    }
}
