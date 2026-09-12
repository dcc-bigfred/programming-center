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
    /// Structured success payload (`firmware.list` / `scan` / `status` / `update`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
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
            result: None,
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
            result: None,
        }
    }

    #[must_use]
    pub fn ok_result(result: serde_json::Value) -> Self {
        Self {
            ok: true,
            error: None,
            detail: None,
            reverted: None,
            cvs: None,
            errors: None,
            result: Some(result),
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
            result: None,
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
            result: None,
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
            result: None,
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

/// `function.set` — locomotive function on the ops track (not a pulse).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionSetPayload {
    #[serde(default)]
    pub station_id: Option<u64>,
    pub address: u16,
    pub function: u8,
    pub on: bool,
}

/// `firmware.update` — basename of a `.bin` plus scan candidate key (BSSID).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareUpdatePayload {
    pub key: String,
    pub file: String,
}

/// `firmware.watch` / `firmware.cancel`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareJobPayload {
    #[serde(default)]
    pub job_id: String,
}

/// One `*.bin` in `$DATA_DIR/var/railbox/rb23xx/firmware`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareFile {
    pub name: String,
    pub size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mtime: Option<i64>,
}

/// Soft-AP candidate from wireless-programmer `scan` (RB23xx only).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareCandidate {
    pub key: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rssi: Option<i32>,
    pub driver: String,
}

/// `firmware.progress` — proxy of wireless-programmer `job.watch`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareProgress {
    pub job_id: String,
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// `telemetry.subscribe` — watch RailCom DYN for one locomotive (Z21 LAN).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySubscribePayload {
    #[serde(default)]
    pub station_id: Option<u64>,
    /// DCC locomotive address (1–10239).
    pub address: u16,
}

/// Channel-1 ID 3 flags (RCN-217 Table 12), when present.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryInfo1 {
    pub orientation_positive: bool,
    pub travel_negative: bool,
    pub moving: bool,
    pub consist: bool,
    pub request_channel2: bool,
}

/// One RailCom snapshot (`telemetry.update`, same `id` as the subscribe).
///
/// Z21 LAN `0x88` fills `address` / `speed_kmh` / `qos_percent` only. The remaining
/// RCN-217 Table 13 fields stay in the wire schema for a future non-Z21 source.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryUpdate {
    /// DCC locomotive address.
    pub address: u16,
    /// True speed in km/h (DYN 0 / 1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speed_kmh: Option<u16>,
    /// Reception quality 0–100 (DYN 7).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub qos_percent: Option<u8>,
    /// Load 0–127 (DYN 2, bit 7 clear).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub load: Option<u8>,
    /// Speed in 128 steps, 0–127 (DYN 2, bit 7 set).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speed_128: Option<u8>,
    /// Tank 1–12 contents in percent (DYN 8–19). Omitted when every slot is empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tanks: Option<[Option<u8>; 12]>,
    /// Location address (DYN 20 / EXT ID 3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location_address: Option<u16>,
    /// Temperature in °C (DYN 26).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature_c: Option<i16>,
    /// Track voltage in millivolts (DYN 46).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_voltage_mv: Option<u16>,
    /// Warning / alarm byte (DYN 21).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<u8>,
    /// Channel-1 Info1 (ID 3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub info1: Option<TelemetryInfo1>,
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
pub const TYPE_TELEMETRY_SUBSCRIBE: &str = "telemetry.subscribe";
pub const TYPE_TELEMETRY_CANCEL: &str = "telemetry.cancel";
pub const TYPE_TELEMETRY_UPDATE: &str = "telemetry.update";
pub const TYPE_FUNCTION_SET: &str = "function.set";
pub const TYPE_FIRMWARE_STATUS: &str = "firmware.status";
pub const TYPE_FIRMWARE_LIST: &str = "firmware.list";
pub const TYPE_FIRMWARE_SCAN: &str = "firmware.scan";
pub const TYPE_FIRMWARE_UPDATE: &str = "firmware.update";
pub const TYPE_FIRMWARE_WATCH: &str = "firmware.watch";
pub const TYPE_FIRMWARE_CANCEL: &str = "firmware.cancel";
pub const TYPE_FIRMWARE_PROGRESS: &str = "firmware.progress";
pub const TYPE_AUTH: &str = "auth";
pub const TYPE_ACK: &str = "ack";

/// wireless-programmer driver id for RailBOX RB23xx Soft-AP.
pub const RB23XX_DRIVER: &str = "rb23xx";
/// Default F-key that turns RB23xx Soft-AP on (CV 200).
pub const RB23XX_WIFI_FUNCTION: u8 = 28;

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
pub const CODE_Z21_REQUIRED: &str = "z21_required";
pub const CODE_WP_UNAVAILABLE: &str = "wireless_programmer_unavailable";
pub const CODE_INVALID_FUNCTION: &str = "invalid_function";
pub const CODE_INVALID_FIRMWARE_FILE: &str = "invalid_firmware_file";

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
        assert_eq!(TYPE_TELEMETRY_SUBSCRIBE, "telemetry.subscribe");
        assert_eq!(TYPE_TELEMETRY_CANCEL, "telemetry.cancel");
        assert_eq!(TYPE_TELEMETRY_UPDATE, "telemetry.update");
        assert_eq!(TYPE_FUNCTION_SET, "function.set");
        assert_eq!(TYPE_FIRMWARE_STATUS, "firmware.status");
        assert_eq!(TYPE_FIRMWARE_LIST, "firmware.list");
        assert_eq!(TYPE_FIRMWARE_SCAN, "firmware.scan");
        assert_eq!(TYPE_FIRMWARE_UPDATE, "firmware.update");
        assert_eq!(TYPE_FIRMWARE_WATCH, "firmware.watch");
        assert_eq!(TYPE_FIRMWARE_CANCEL, "firmware.cancel");
        assert_eq!(TYPE_FIRMWARE_PROGRESS, "firmware.progress");
        assert_eq!(CODE_Z21_REQUIRED, "z21_required");
        assert_eq!(CODE_WP_UNAVAILABLE, "wireless_programmer_unavailable");
        assert_eq!(RB23XX_DRIVER, "rb23xx");
        assert_eq!(RB23XX_WIFI_FUNCTION, 28);
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
    fn telemetry_update_omits_empty_fields() {
        let u = TelemetryUpdate {
            address: 13,
            speed_kmh: Some(80),
            ..TelemetryUpdate::default()
        };
        let v = serde_json::to_value(&u).unwrap();
        assert_eq!(v["address"], 13);
        assert_eq!(v["speedKmh"], 80);
        assert!(v.get("qosPercent").is_none());
        assert!(v.get("load").is_none());
        assert!(v.get("tanks").is_none());
        assert!(v.get("info1").is_none());
    }

    #[test]
    fn telemetry_update_serialises_table13() {
        let mut tanks = [None; 12];
        tanks[0] = Some(40);
        tanks[11] = Some(99);
        let u = TelemetryUpdate {
            address: 13,
            load: Some(5),
            speed_128: Some(64),
            tanks: Some(tanks),
            location_address: Some(0x123),
            temperature_c: Some(21),
            track_voltage_mv: Some(14_500),
            warning: Some(3),
            info1: Some(TelemetryInfo1 {
                orientation_positive: true,
                moving: true,
                ..TelemetryInfo1::default()
            }),
            ..TelemetryUpdate::default()
        };
        let v = serde_json::to_value(&u).unwrap();
        assert_eq!(v["load"], 5);
        assert_eq!(v["speed128"], 64);
        assert_eq!(v["tanks"][0], 40);
        assert!(v["tanks"][1].is_null());
        assert_eq!(v["tanks"][11], 99);
        assert_eq!(v["locationAddress"], 0x123);
        assert_eq!(v["temperatureC"], 21);
        assert_eq!(v["trackVoltageMv"], 14_500);
        assert_eq!(v["warning"], 3);
        assert_eq!(v["info1"]["orientationPositive"], true);
        assert_eq!(v["info1"]["moving"], true);
        assert_eq!(v["info1"]["travelNegative"], false);
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
