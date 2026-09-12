//! `firmware.*` and `function.set` WebSocket commands.

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use pc_core::LONG_MAX;
use pc_proto::{
    Ack, FirmwareJobPayload, FirmwareProgress, FirmwareUpdatePayload, FunctionSetPayload,
    CODE_CANCELLED, CODE_INVALID_ADDRESS, CODE_INVALID_FUNCTION, CODE_PC_DISABLED,
    CODE_WP_UNAVAILABLE,
};

use crate::bus::Hub;
use crate::config::Config;
use crate::error::ApiError;
use crate::wp::{self, WpLink};
use crate::AppState;

const MAX_FUNCTION: u8 = 28;

pub fn status(cfg: &Config, wp: &WpLink) -> Ack {
    if !cfg.enabled {
        return Ack::fail(CODE_PC_DISABLED, None);
    }
    Ack::ok_result(serde_json::json!({
        "enabled": cfg.wireless_programmer.enabled,
        "connected": wp.connected(),
    }))
}

pub fn list(cfg: &Config, state: &AppState) -> Ack {
    if !cfg.enabled {
        return Ack::fail(CODE_PC_DISABLED, None);
    }
    let dir = wp::firmware_dir(&state.data_dir);
    match wp::list_bins(&dir) {
        Ok(files) => Ack::ok_result(serde_json::json!({ "files": files })),
        Err(err) => err.into_ack(),
    }
}

pub async fn scan(cfg: &Config, state: &AppState) -> Ack {
    if let Some(ack) = wp_guard(cfg, state) {
        return ack;
    }
    match wp::scan_rb23xx().await {
        Ok(candidates) => {
            state.wp.set_connected(true);
            Ack::ok_result(serde_json::json!({ "candidates": candidates }))
        }
        Err(err) => {
            mark_down_if_unavailable(&state.wp, &err);
            err.into_ack()
        }
    }
}

pub async fn update(cfg: &Config, state: &AppState, p: FirmwareUpdatePayload) -> Ack {
    if let Some(ack) = wp_guard(cfg, state) {
        return ack;
    }
    let dir = wp::firmware_dir(&state.data_dir);
    let path = match wp::resolve_bin(&dir, &p.file) {
        Ok(p) => p,
        Err(err) => return err.into_ack(),
    };
    if p.key.trim().is_empty() {
        return Ack::fail("bad_payload", Some("key required".into()));
    }
    match wp::update_firmware(p.key.trim(), &path).await {
        Ok(job_id) => {
            state.wp.set_connected(true);
            Ack::ok_result(serde_json::json!({ "jobId": job_id }))
        }
        Err(err) => {
            mark_down_if_unavailable(&state.wp, &err);
            err.into_ack()
        }
    }
}

pub async fn watch(
    cfg: &Config,
    state: &AppState,
    p: FirmwareJobPayload,
    cancel: CancellationToken,
    on_progress: mpsc::Sender<FirmwareProgress>,
) -> Ack {
    if let Some(ack) = wp_guard(cfg, state) {
        return ack;
    }
    if p.job_id.trim().is_empty() {
        return Ack::fail("bad_payload", Some("jobId required".into()));
    }
    let job_id = p.job_id.clone();
    let (tx, mut rx) = mpsc::channel(16);
    let watch_id = job_id.clone();
    let handle = tokio::task::spawn_blocking(move || wp::watch_job(watch_id, tx));
    let mut last: Option<FirmwareProgress> = None;
    loop {
        tokio::select! {
            () = cancel.cancelled() => {
                let _ = wp::cancel_job(job_id).await;
                handle.abort();
                return Ack::fail(CODE_CANCELLED, None);
            }
            frame = rx.recv() => {
                let Some(frame) = frame else { break };
                last = Some(frame.clone());
                if on_progress.send(frame).await.is_err() {
                    break;
                }
            }
        }
    }
    match handle.await {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            mark_down_if_unavailable(&state.wp, &err);
            return err.into_ack();
        }
        Err(err) if err.is_cancelled() => return Ack::fail(CODE_CANCELLED, None),
        Err(err) => {
            return ApiError::internal("wp_join")
                .with_detail(err.to_string())
                .into_ack()
        }
    }
    match last {
        Some(frame) if frame.state == "done" => Ack::ok(),
        Some(frame) if frame.state == "cancelled" => Ack::fail(CODE_CANCELLED, frame.detail),
        Some(frame) if frame.state == "failed" => Ack::fail("programming_failed", frame.detail),
        Some(frame) => Ack::fail("programming_failed", Some(frame.state)),
        None => Ack::fail("programming_failed", Some("watch ended".into())),
    }
}

pub async fn cancel_job(cfg: &Config, state: &AppState, p: FirmwareJobPayload) -> Ack {
    if let Some(ack) = wp_guard(cfg, state) {
        return ack;
    }
    if p.job_id.trim().is_empty() {
        return Ack::ok();
    }
    match wp::cancel_job(p.job_id).await {
        Ok(()) => Ack::ok(),
        Err(err) => {
            mark_down_if_unavailable(&state.wp, &err);
            err.into_ack()
        }
    }
}

pub async fn set_function(
    cfg: &Config,
    hub: &Hub,
    token: Option<&str>,
    p: FunctionSetPayload,
    cancel: &CancellationToken,
) -> Ack {
    if !cfg.enabled {
        return Ack::fail(CODE_PC_DISABLED, None);
    }
    if !(1..=LONG_MAX).contains(&p.address) {
        return Ack::fail(CODE_INVALID_ADDRESS, None);
    }
    if p.function > MAX_FUNCTION {
        return Ack::fail(CODE_INVALID_FUNCTION, None);
    }
    match hub
        .set_function(
            cfg.cv_bus(),
            token,
            p.station_id,
            p.address,
            p.function,
            p.on,
            cancel,
        )
        .await
    {
        Ok(()) => Ack::ok(),
        Err(err) if err.code == CODE_CANCELLED || cancel.is_cancelled() => {
            Ack::fail(CODE_CANCELLED, None)
        }
        Err(err) => err.into_ack(),
    }
}

fn wp_guard(cfg: &Config, state: &AppState) -> Option<Ack> {
    if !cfg.enabled {
        return Some(Ack::fail(CODE_PC_DISABLED, None));
    }
    if !cfg.wireless_programmer.enabled || !state.wp.connected() {
        return Some(Ack::fail(CODE_WP_UNAVAILABLE, None));
    }
    None
}

fn mark_down_if_unavailable(wp: &WpLink, err: &ApiError) {
    if err.code == CODE_WP_UNAVAILABLE {
        wp.set_connected(false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pc_proto::FunctionSetPayload;

    #[test]
    fn function_set_payload_parses() {
        let p: FunctionSetPayload =
            serde_json::from_str(r#"{"address":13,"function":28,"on":true}"#).unwrap();
        assert_eq!(p.address, 13);
        assert_eq!(p.function, 28);
        assert!(p.on);
        assert_eq!(p.station_id, None);
    }

    #[test]
    fn firmware_update_payload_parses() {
        let p: FirmwareUpdatePayload =
            serde_json::from_str(r#"{"key":"aa:bb","file":"rb.bin"}"#).unwrap();
        assert_eq!(p.key, "aa:bb");
        assert_eq!(p.file, "rb.bin");
    }
}
