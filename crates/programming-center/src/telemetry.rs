//! `telemetry.subscribe`: live RailCom snapshots for one locomotive (Z21 LAN).

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use pc_core::LONG_MAX;
use pc_proto::{
    Ack, TelemetrySubscribePayload, TelemetryUpdate, CODE_CANCELLED, CODE_INVALID_ADDRESS,
    CODE_PC_DISABLED, CODE_Z21_REQUIRED,
};

use crate::bus::{Hub, Z21RailcomSnap};
use crate::config::{Config, ProgrammingMode};

pub async fn subscribe(
    cfg: &Config,
    hub: &Hub,
    p: TelemetrySubscribePayload,
    cancel: &CancellationToken,
    on_update: mpsc::Sender<TelemetryUpdate>,
) -> Ack {
    if !cfg.enabled {
        return Ack::fail(CODE_PC_DISABLED, None);
    }
    if !cfg.cv_bus().is_z21() {
        return Ack::fail(CODE_Z21_REQUIRED, None);
    }
    if !(1..=LONG_MAX).contains(&p.address) {
        return Ack::fail(CODE_INVALID_ADDRESS, None);
    }
    let addr = p.address;
    let (tx, mut rx) = mpsc::channel::<Z21RailcomSnap>(8);
    let fwd = tokio::spawn(async move {
        while let Some(snap) = rx.recv().await {
            if on_update.send(update_from_snap(addr, snap)).await.is_err() {
                break;
            }
        }
    });
    let result = hub
        .watch_railcom(ProgrammingMode::Z21, addr, cancel, tx)
        .await;
    fwd.abort();
    match result {
        Ok(()) => Ack::ok(),
        Err(err) if err.code == CODE_CANCELLED || cancel.is_cancelled() => {
            Ack::fail(CODE_CANCELLED, None)
        }
        Err(err) => err.into_ack(),
    }
}

fn update_from_snap(fallback_addr: u16, snap: Z21RailcomSnap) -> TelemetryUpdate {
    TelemetryUpdate {
        address: if snap.address == 0 {
            fallback_addr
        } else {
            snap.address
        },
        speed_kmh: snap.speed_kmh,
        qos_percent: snap.qos_percent,
        ..TelemetryUpdate::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use tokio::sync::RwLock;

    use crate::config::IntegrationMode;

    fn test_hub() -> Hub {
        let cfg = Config::default();
        let data = crate::config::resolve_data_dir();
        let bf = Arc::new(RwLock::new(cfg.bigfred_view(&data)));
        let http = reqwest::Client::new();
        let dcc = Arc::new(bigfred_client::DccBusClient::new(bf, http));
        Hub::new(dcc, Arc::new(RwLock::new(cfg)))
    }

    #[test]
    fn payload_requires_address() {
        let p: TelemetrySubscribePayload = serde_json::from_str(r#"{"address":13}"#).expect("json");
        assert_eq!(p.address, 13);
        assert_eq!(p.station_id, None);
    }

    #[tokio::test]
    async fn subscribe_dcc_bus_is_z21_required() {
        let mut cfg = Config::default();
        cfg.enabled = true;
        let (tx, _rx) = mpsc::channel(1);
        let ack = subscribe(
            &cfg,
            &test_hub(),
            TelemetrySubscribePayload {
                station_id: None,
                address: 13,
            },
            &CancellationToken::new(),
            tx,
        )
        .await;
        assert_eq!(ack.error.as_deref(), Some(CODE_Z21_REQUIRED));
    }

    #[tokio::test]
    async fn subscribe_rejects_address_zero() {
        let mut cfg = Config::default();
        cfg.enabled = true;
        cfg.mode = IntegrationMode::Standalone;
        let (tx, _rx) = mpsc::channel(1);
        let ack = subscribe(
            &cfg,
            &test_hub(),
            TelemetrySubscribePayload {
                station_id: None,
                address: 0,
            },
            &CancellationToken::new(),
            tx,
        )
        .await;
        assert_eq!(ack.error.as_deref(), Some(CODE_INVALID_ADDRESS));
    }

    #[test]
    fn update_from_snap_keeps_z21_fields_only() {
        let u = update_from_snap(
            7,
            Z21RailcomSnap {
                address: 13,
                speed_kmh: Some(80),
                qos_percent: Some(12),
            },
        );
        assert_eq!(u.address, 13);
        assert_eq!(u.speed_kmh, Some(80));
        assert_eq!(u.qos_percent, Some(12));
        assert_eq!(u.load, None);
        assert_eq!(u.speed_128, None);
        assert_eq!(u.tanks, None);
        assert_eq!(u.location_address, None);
        assert_eq!(u.temperature_c, None);
        assert_eq!(u.track_voltage_mv, None);
        assert_eq!(u.warning, None);
        assert_eq!(u.info1, None);
    }

    #[test]
    fn update_from_snap_falls_back_when_address_zero() {
        let u = update_from_snap(
            13,
            Z21RailcomSnap {
                address: 0,
                speed_kmh: Some(80),
                qos_percent: None,
            },
        );
        assert_eq!(u.address, 13);
        assert_eq!(u.tanks, None);
        assert_eq!(u.info1, None);
    }
}
