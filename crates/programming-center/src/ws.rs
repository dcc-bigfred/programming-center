//! Browser WebSocket: Direct CV read / write / bitop.

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::warn;

use pc_core::{apply_bitop, expand_cv_list, valid_cv, CvBatch, CvEntry, ExpandError};
use pc_proto::{
    Ack, CvBitopPayload, CvProgress, CvReadPayload, CvWritePayload, Envelope, TYPE_ACK,
    TYPE_CV_BITOP, TYPE_CV_PROGRESS, TYPE_CV_READ, TYPE_CV_READ_CANCEL, TYPE_CV_WRITE,
};

use crate::bus::CvReadReport;
use crate::error::ApiError;
use crate::AppState;

/// dcc-bus ack timeout is 30s for the whole frame; keep a chunk inside that.
const DCC_BUS_CHUNK: usize = 8;

#[derive(Debug, Deserialize)]
pub struct WsQuery {
    #[serde(default)]
    pub token: Option<String>,
}

pub async fn ws_upgrade(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state, q.token))
}

async fn handle_socket(socket: WebSocket, state: AppState, token: Option<String>) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::channel::<Message>(32);
    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    'socket: while let Some(Ok(msg)) = stream.next().await {
        let text = match inbound_text(msg, &tx).await {
            Inbound::Skip => continue,
            Inbound::Closed => break,
            Inbound::Text(t) => t,
        };
        let env: Envelope = match serde_json::from_str(&text) {
            Ok(e) => e,
            Err(err) => {
                warn!(error = %err, "bad ws frame");
                continue;
            }
        };
        if env.kind == TYPE_CV_READ_CANCEL {
            continue;
        }

        let cfg = state.config().await;
        if env.kind == TYPE_CV_READ && cfg.mode.is_standalone() {
            let cancel = CancellationToken::new();
            let req_id = env.id.clone();
            let mut read = std::pin::pin!(cv_read_standalone(
                &state,
                token.as_deref(),
                &env,
                cancel.clone(),
                tx.clone(),
            ));
            loop {
                tokio::select! {
                    ack = &mut read => {
                        if !send_envelope(&tx, TYPE_ACK, env.id.clone(), &ack).await {
                            break 'socket;
                        }
                        break;
                    }
                    incoming = stream.next() => {
                        match incoming {
                            None | Some(Err(_)) => {
                                cancel.cancel();
                                let ack = read.await;
                                let _ = send_envelope(&tx, TYPE_ACK, env.id.clone(), &ack).await;
                                break 'socket;
                            }
                            Some(Ok(Message::Close(_))) => {
                                cancel.cancel();
                                let _ = read.await;
                                break 'socket;
                            }
                            Some(Ok(Message::Ping(p))) => {
                                if tx.send(Message::Pong(p)).await.is_err() {
                                    cancel.cancel();
                                    let _ = read.await;
                                    break 'socket;
                                }
                            }
                            Some(Ok(other)) => {
                                if is_cancel_for(&req_id, &other) {
                                    cancel.cancel();
                                } else if let Some(kind) = inbound_kind(&other) {
                                    warn!(
                                        kind,
                                        "ignoring websocket frame during standalone cv.read"
                                    );
                                }
                            }
                        }
                    }
                }
            }
            continue;
        }

        let ack = dispatch(&state, token.as_deref(), &env).await;
        if !send_envelope(&tx, TYPE_ACK, env.id.clone(), &ack).await {
            break;
        }
    }
    drop(tx);
    let _ = writer.await;
}

enum Inbound {
    Skip,
    Closed,
    Text(String),
}

async fn inbound_text(msg: Message, tx: &mpsc::Sender<Message>) -> Inbound {
    match msg {
        Message::Text(t) => Inbound::Text(t),
        Message::Binary(b) => match String::from_utf8(b) {
            Ok(t) => Inbound::Text(t),
            Err(_) => Inbound::Skip,
        },
        Message::Close(_) => Inbound::Closed,
        Message::Ping(p) => {
            if tx.send(Message::Pong(p)).await.is_err() {
                Inbound::Closed
            } else {
                Inbound::Skip
            }
        }
        _ => Inbound::Skip,
    }
}

fn inbound_kind(msg: &Message) -> Option<String> {
    let text = match msg {
        Message::Text(t) => t.as_str(),
        Message::Binary(b) => std::str::from_utf8(b).ok()?,
        _ => return None,
    };
    serde_json::from_str::<Envelope>(text)
        .ok()
        .map(|env| env.kind)
}

fn is_cancel_for(req_id: &Option<String>, msg: &Message) -> bool {
    let text = match msg {
        Message::Text(t) => t.as_str(),
        Message::Binary(b) => match std::str::from_utf8(b) {
            Ok(t) => t,
            Err(_) => return false,
        },
        _ => return false,
    };
    let Ok(env) = serde_json::from_str::<Envelope>(text) else {
        return false;
    };
    env.kind == TYPE_CV_READ_CANCEL && env.id == *req_id
}

async fn send_envelope(
    tx: &mpsc::Sender<Message>,
    kind: &str,
    id: Option<String>,
    payload: &impl Serialize,
) -> bool {
    let reply = Envelope {
        kind: kind.to_string(),
        id,
        payload: serde_json::to_value(payload).ok(),
    };
    let Ok(json) = serde_json::to_string(&reply) else {
        return false;
    };
    tx.send(Message::Text(json)).await.is_ok()
}

async fn dispatch(state: &AppState, token: Option<&str>, env: &Envelope) -> Ack {
    let payload = env.payload.clone().unwrap_or(serde_json::Value::Null);
    match env.kind.as_str() {
        TYPE_CV_READ => match serde_json::from_value::<CvReadPayload>(payload) {
            Ok(p) => cv_read(state, token, p).await,
            Err(e) => Ack::fail("bad_payload", Some(e.to_string())),
        },
        TYPE_CV_WRITE => match serde_json::from_value::<CvWritePayload>(payload) {
            Ok(p) => cv_write(state, token, p).await,
            Err(e) => Ack::fail("bad_payload", Some(e.to_string())),
        },
        TYPE_CV_BITOP => match serde_json::from_value::<CvBitopPayload>(payload) {
            Ok(p) => cv_bitop(state, token, p).await,
            Err(e) => Ack::fail("bad_payload", Some(e.to_string())),
        },
        other => Ack::fail("unknown_command", Some(other.to_string())),
    }
}

fn map_bus(err: ApiError) -> Ack {
    err.into_ack()
}

fn map_expand(err: ExpandError) -> Ack {
    match err {
        ExpandError::Empty | ExpandError::InvalidRange => {
            Ack::fail("bad_payload", Some("cv list or range required".into()))
        }
        ExpandError::InvalidCv => Ack::fail("invalid_cv", None),
    }
}

async fn probe_cv1(
    state: &AppState,
    token: Option<&str>,
    station_id: Option<u64>,
    address: u16,
    track: pc_core::Track,
) -> Result<u8, ApiError> {
    let cfg = state.config().await;
    let batch = state
        .hub
        .read_cvs(cfg.mode, token, station_id, address, &[1], track)
        .await?;
    if let Some(entry) = batch.cvs.iter().find(|e| e.cv == 1) {
        return Ok(entry.value);
    }
    Err(ApiError::unavailable("decoder_absent"))
}

async fn read_chunked(
    state: &AppState,
    token: Option<&str>,
    station_id: Option<u64>,
    address: u16,
    cvs: &[u16],
    track: pc_core::Track,
) -> Result<CvBatch, ApiError> {
    if cvs.is_empty() {
        return Ok(CvBatch::default());
    }
    let cfg = state.config().await;
    if cfg.mode.is_standalone() || cvs.len() <= DCC_BUS_CHUNK {
        return state
            .hub
            .read_cvs(cfg.mode, token, station_id, address, cvs, track)
            .await;
    }
    let mut out = CvBatch::default();
    for chunk in cvs.chunks(DCC_BUS_CHUNK) {
        out.merge(
            state
                .hub
                .read_cvs(cfg.mode, token, station_id, address, chunk, track)
                .await?,
        );
    }
    Ok(out)
}

async fn write_chunked(
    state: &AppState,
    token: Option<&str>,
    station_id: Option<u64>,
    address: u16,
    cvs: &[CvEntry],
    track: pc_core::Track,
) -> Result<CvBatch, ApiError> {
    if cvs.is_empty() {
        return Ok(CvBatch::default());
    }
    let cfg = state.config().await;
    if cfg.mode.is_standalone() || cvs.len() <= DCC_BUS_CHUNK {
        return state
            .hub
            .write_cvs(cfg.mode, token, station_id, address, cvs, track)
            .await;
    }
    let mut out = CvBatch::default();
    for chunk in cvs.chunks(DCC_BUS_CHUNK) {
        out.merge(
            state
                .hub
                .write_cvs(cfg.mode, token, station_id, address, chunk, track)
                .await?,
        );
    }
    Ok(out)
}

async fn cv_read(state: &AppState, token: Option<&str>, p: CvReadPayload) -> Ack {
    let cfg = state.config().await;
    if !cfg.enabled {
        return Ack::fail("pc_disabled", None);
    }
    let mut nums = match expand_cv_list(&p.cvs, p.from, p.to, p.skip_address) {
        Ok(n) => n,
        Err(e) => return map_expand(e),
    };
    let dump = p.from.is_some() || p.to.is_some();
    let mut batch = CvBatch::default();
    if dump && nums.len() > 1 {
        match probe_cv1(state, token, p.station_id, p.address, p.track).await {
            Ok(value) => {
                if nums.contains(&1) {
                    batch.cvs.push(CvEntry { cv: 1, value });
                    nums.retain(|n| *n != 1);
                }
            }
            Err(e) => return map_bus(e),
        }
    }
    match read_chunked(state, token, p.station_id, p.address, &nums, p.track).await {
        Ok(part) => batch.merge(part),
        Err(e) => return map_bus(e),
    }
    if !dump && batch.cvs.is_empty() && !batch.errors.is_empty() {
        return Ack::fail("programming_failed", None);
    }
    Ack::ok_batch(batch.cvs, batch.errors)
}

async fn cv_read_standalone(
    state: &AppState,
    token: Option<&str>,
    env: &Envelope,
    cancel: CancellationToken,
    tx: mpsc::Sender<Message>,
) -> Ack {
    let payload = env.payload.clone().unwrap_or(serde_json::Value::Null);
    let p = match serde_json::from_value::<CvReadPayload>(payload) {
        Ok(p) => p,
        Err(e) => return Ack::fail("bad_payload", Some(e.to_string())),
    };
    let cfg = state.config().await;
    if !cfg.enabled {
        return Ack::fail("pc_disabled", None);
    }
    let mut nums = match expand_cv_list(&p.cvs, p.from, p.to, p.skip_address) {
        Ok(n) => n,
        Err(e) => return map_expand(e),
    };
    let dump = p.from.is_some() || p.to.is_some();
    let mut batch = CvBatch::default();
    if dump && nums.len() > 1 {
        let include_cv1 = nums.contains(&1);
        let total = u32::try_from(nums.len()).unwrap_or(u32::MAX);
        if include_cv1 {
            let _ = send_envelope(
                &tx,
                TYPE_CV_PROGRESS,
                env.id.clone(),
                &CvProgress::reading(1, 0, total),
            )
            .await;
        }
        match probe_cv1(state, token, p.station_id, p.address, p.track).await {
            Ok(value) => {
                if include_cv1 {
                    batch.cvs.push(CvEntry { cv: 1, value });
                    nums.retain(|n| *n != 1);
                    let _ = send_envelope(
                        &tx,
                        TYPE_CV_PROGRESS,
                        env.id.clone(),
                        &CvProgress::got(1, value, 1, total),
                    )
                    .await;
                }
            }
            Err(e) => return map_bus(e),
        }
    }
    if cancel.is_cancelled() {
        return Ack::fail("cancelled", None);
    }
    let probed = u32::try_from(batch.cvs.len()).unwrap_or(0);
    let rest = u32::try_from(nums.len()).unwrap_or(0);
    let total = probed.saturating_add(rest);
    if nums.is_empty() {
        return finish_read(dump, batch);
    }

    let (prog_tx, mut prog_rx) = mpsc::channel::<CvProgress>(8);
    let id = env.id.clone();
    let fwd = tokio::spawn(async move {
        while let Some(p) = prog_rx.recv().await {
            if !send_envelope(&tx, TYPE_CV_PROGRESS, id.clone(), &p).await {
                break;
            }
        }
    });
    let result = state
        .hub
        .read_cvs_reporting(
            p.address,
            &nums,
            p.track,
            &cancel,
            CvReadReport {
                progress: prog_tx,
                done_base: probed,
                total,
            },
        )
        .await;
    let _ = fwd.await;
    if cancel.is_cancelled() {
        return Ack::fail("cancelled", None);
    }
    match result {
        Ok(part) => batch.merge(part),
        Err(e) => return map_bus(e),
    }
    finish_read(dump, batch)
}

fn finish_read(dump: bool, batch: CvBatch) -> Ack {
    if !dump && batch.cvs.is_empty() && !batch.errors.is_empty() {
        return Ack::fail("programming_failed", None);
    }
    Ack::ok_batch(batch.cvs, batch.errors)
}

async fn cv_write(state: &AppState, token: Option<&str>, p: CvWritePayload) -> Ack {
    let cfg = state.config().await;
    if !cfg.enabled {
        return Ack::fail("pc_disabled", None);
    }
    if p.cvs.is_empty() {
        return Ack::fail("bad_payload", Some("cv list required".into()));
    }
    for e in &p.cvs {
        if !valid_cv(e.cv) {
            return Ack::fail("invalid_cv", None);
        }
    }
    if p.cvs.len() > 1 {
        if let Err(e) = probe_cv1(state, token, p.station_id, p.address, p.track).await {
            return map_bus(e);
        }
    }
    match write_chunked(state, token, p.station_id, p.address, &p.cvs, p.track).await {
        Ok(batch) => Ack::ok_batch(batch.cvs, batch.errors),
        Err(e) => map_bus(e),
    }
}

async fn cv_bitop(state: &AppState, token: Option<&str>, p: CvBitopPayload) -> Ack {
    if !valid_cv(p.cv) {
        return Ack::fail("invalid_cv", None);
    }
    let cfg = state.config().await;
    if !cfg.enabled {
        return Ack::fail("pc_disabled", None);
    }
    let read = match state
        .hub
        .read_cvs(cfg.mode, token, p.station_id, p.address, &[p.cv], p.track)
        .await
    {
        Ok(v) => v,
        Err(e) => return map_bus(e),
    };
    let Some(old) = read.cvs.first() else {
        return Ack::fail("programming_failed", Some("empty read".into()));
    };
    let new_val = apply_bitop(old.value, p.and_mask, p.or_mask);
    let entry = CvEntry {
        cv: p.cv,
        value: new_val,
    };
    match state
        .hub
        .write_cvs(cfg.mode, token, p.station_id, p.address, &[entry], p.track)
        .await
    {
        Ok(cvs) => Ack::ok_cvs(cvs.cvs),
        Err(e) => map_bus(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(json: &str) -> Message {
        Message::Text(json.to_string())
    }

    #[test]
    fn cancel_matches_request_id() {
        let id = Some("req-1".to_string());
        assert!(is_cancel_for(
            &id,
            &text(r#"{"type":"cv.read.cancel","id":"req-1"}"#),
        ));
        assert!(!is_cancel_for(
            &id,
            &text(r#"{"type":"cv.read.cancel","id":"other"}"#),
        ));
        assert!(!is_cancel_for(
            &id,
            &text(r#"{"type":"cv.write","id":"req-1"}"#),
        ));
        assert!(!is_cancel_for(&id, &Message::Ping(Vec::new())));
    }

    #[test]
    fn inbound_kind_reads_type() {
        assert_eq!(
            inbound_kind(&text(r#"{"type":"cv.write","id":"1"}"#)).as_deref(),
            Some("cv.write")
        );
        assert_eq!(inbound_kind(&Message::Ping(Vec::new())), None);
    }

    #[test]
    fn cv1_probe_sends_reading_then_got() {
        let reading = CvProgress::reading(1, 0, 1000);
        let got = CvProgress::got(1, 42, 1, 1000);
        assert_eq!(reading.current, Some(1));
        assert_eq!(reading.done, 0);
        assert_eq!(got, CvProgress::got(1, 42, 1, 1000));
        assert!(got.value.is_some());
        assert!(reading.value.is_none());
    }

    #[test]
    fn finish_read_fails_when_every_slot_errored() {
        let ack = finish_read(
            false,
            CvBatch {
                cvs: Vec::new(),
                errors: vec![33],
            },
        );
        assert!(!ack.ok);
        assert_eq!(ack.error.as_deref(), Some("programming_failed"));
        let dump = finish_read(
            true,
            CvBatch {
                cvs: Vec::new(),
                errors: vec![33],
            },
        );
        assert!(dump.ok);
    }

    #[test]
    fn standalone_cancel_ack_is_cancelled() {
        let ack = Ack::fail("cancelled", None);
        assert!(!ack.ok);
        assert_eq!(ack.error.as_deref(), Some("cancelled"));
        assert!(ack.cvs.is_none());
    }
}
