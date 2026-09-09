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
    /// Structured payload for [`CODE_ADDRESS_REVERTED`]; preferred over `detail`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reverted: Option<RevertedDetail>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cvs: Option<Vec<CvEntry>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<u16>>,
}

/// Structured `address_reverted` detail. The frontend localises from this
/// instead of parsing a free-form `detail` string.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RevertedDetail {
    /// CV 29 value read after the write.
    pub cv29: u8,
    /// RailCom-recognised loco addresses observed while leaving service mode.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub railcom: Vec<u16>,
    /// Programming-track current (mA) from LAN_SYSTEMSTATE, if seen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prog_current_ma: Option<i16>,
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
            reverted: None,
            cvs: Some(cvs),
            errors: if errors.is_empty() {
                None
            } else {
                Some(errors)
            },
        }
    }

    #[must_use]
    pub fn ok() -> Self {
        Self {
            ok: true,
            error: None,
            detail: None,
            reverted: None,
            cvs: None,
            errors: None,
        }
    }

    #[must_use]
    pub fn fail(code: impl Into<String>, detail: Option<String>) -> Self {
        Self {
            ok: false,
            error: Some(code.into()),
            detail,
            reverted: None,
            cvs: None,
            errors: None,
        }
    }

    /// Failure that still carries the CVs actually present in the decoder.
    #[must_use]
    pub fn fail_cvs(code: impl Into<String>, detail: Option<String>, cvs: Vec<CvEntry>) -> Self {
        Self {
            ok: false,
            error: Some(code.into()),
            detail,
            reverted: None,
            cvs: Some(cvs),
            errors: None,
        }
    }

    /// `address_reverted` failure with structured detail.
    #[must_use]
    pub fn fail_reverted(reverted: RevertedDetail, cvs: Vec<CvEntry>) -> Self {
        Self {
            ok: false,
            error: Some(CODE_ADDRESS_REVERTED.into()),
            detail: None,
            reverted: Some(reverted),
            cvs: Some(cvs),
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

fn default_long_bit() -> u8 {
    pc_core::CV29_LONG_BIT
}

/// `address.set` — ESU service-mode address write (all decoder brands for now).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddressSetPayload {
    #[serde(default)]
    pub station_id: Option<u64>,
    /// Session / dcc-bus locomotive address (ignored on the programming track).
    #[serde(default)]
    pub address: u16,
    /// Desired DCC address (1–10239).
    pub new_address: u16,
    /// CV 29 long-address bit. NMRA/ESU/ZIMO default 5; RailBOX uses 3.
    #[serde(default = "default_long_bit")]
    pub long_bit: u8,
    /// `None` = leave CV 28 alone. `Some(v)` writes CV 28 bit 7 (RailComPlus).
    #[serde(default)]
    pub railcom_plus: Option<bool>,
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
pub const TYPE_CV_WRITE_CANCEL: &str = "cv.write.cancel";
pub const TYPE_CV_PROGRESS: &str = "cv.progress";
pub const TYPE_CV_WRITE: &str = "cv.write";
pub const TYPE_CV_BITOP: &str = "cv.bitop";
pub const TYPE_ADDRESS_SET: &str = "address.set";
pub const TYPE_AUTH: &str = "auth";
pub const TYPE_ACK: &str = "ack";

/// `Ack.error` codes — the wire contract shared with the frontend. Keep these
/// in sync with `web/src/api/errorCodes.ts` (generated from this crate).
pub const CODE_PC_DISABLED: &str = "pc_disabled";
pub const CODE_INVALID_ADDRESS: &str = "invalid_address";
pub const CODE_INVALID_LONG_BIT: &str = "invalid_long_bit";
pub const CODE_ADDRESS_REVERTED: &str = "address_reverted";
pub const CODE_PROGRAMMING_FAILED: &str = "programming_failed";
pub const CODE_CANCELLED: &str = "cancelled";
pub const CODE_BAD_PAYLOAD: &str = "bad_payload";
pub const CODE_UNKNOWN_COMMAND: &str = "unknown_command";

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
        assert_eq!(TYPE_ADDRESS_SET, "address.set");
    }

    #[test]
    fn address_set_defaults_long_bit() {
        let p: AddressSetPayload = serde_json::from_str(r#"{"newAddress":9728}"#).unwrap();
        assert_eq!(p.new_address, 9728);
        assert_eq!(p.long_bit, 5);
        assert_eq!(p.address, 0);
        assert_eq!(p.railcom_plus, None);
    }

    #[test]
    fn fail_cvs_keeps_entries() {
        let ack = Ack::fail_cvs(
            "address_reverted",
            Some("CV29=30".into()),
            vec![pc_core::CvEntry { cv: 29, value: 30 }],
        );
        assert!(!ack.ok);
        assert_eq!(ack.error.as_deref(), Some("address_reverted"));
        assert_eq!(ack.cvs.as_ref().map(|c| c.len()), Some(1));
    }

    #[test]
    fn fail_reverted_serialises_structured_detail() {
        let ack = Ack::fail_reverted(
            RevertedDetail {
                cv29: 30,
                railcom: vec![13],
                prog_current_ma: Some(42),
            },
            vec![pc_core::CvEntry { cv: 29, value: 30 }],
        );
        let v = serde_json::to_value(&ack).unwrap();
        assert_eq!(v["error"], "address_reverted");
        assert_eq!(v["reverted"]["cv29"], 30);
        assert_eq!(v["reverted"]["railcom"], serde_json::json!([13]));
        assert_eq!(v["reverted"]["progCurrentMa"], 42);
        assert!(v.get("detail").is_none());
        assert_eq!(v["cvs"][0]["cv"], 29);
    }
}
