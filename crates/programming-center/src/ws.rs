//! Browser WebSocket: Direct CV ops and Managed volume.

use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use tracing::warn;

use pc_core::{
    apply_bitop, expand_cv_list, valid_cv, valid_percent, CvBatch, CvEntry, ExpandError,
    VolumeRegistry,
};
use pc_proto::{
    Ack, CvBitopPayload, CvReadPayload, CvWritePayload, Envelope, VolumePayload, TYPE_ACK,
    TYPE_CV_BITOP, TYPE_CV_READ, TYPE_CV_WRITE, TYPE_VOLUME_GET, TYPE_VOLUME_SET,
};

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
    let volumes = Arc::new(VolumeRegistry::with_builtins());
    while let Some(Ok(msg)) = stream.next().await {
        let text = match msg {
            Message::Text(t) => t,
            Message::Binary(b) => match String::from_utf8(b) {
                Ok(t) => t,
                Err(_) => continue,
            },
            Message::Close(_) => break,
            Message::Ping(p) => {
                let _ = sink.send(Message::Pong(p)).await;
                continue;
            }
            _ => continue,
        };
        let env: Envelope = match serde_json::from_str(&text) {
            Ok(e) => e,
            Err(err) => {
                warn!(error = %err, "bad ws frame");
                continue;
            }
        };
        let ack = dispatch(&state, &volumes, token.as_deref(), &env).await;
        let reply = Envelope {
            kind: TYPE_ACK.to_string(),
            id: env.id,
            payload: serde_json::to_value(&ack).ok(),
        };
        let Ok(json) = serde_json::to_string(&reply) else {
            continue;
        };
        if sink.send(Message::Text(json)).await.is_err() {
            break;
        }
    }
}

async fn dispatch(
    state: &AppState,
    volumes: &VolumeRegistry,
    token: Option<&str>,
    env: &Envelope,
) -> Ack {
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
        TYPE_VOLUME_GET => match serde_json::from_value::<VolumePayload>(payload) {
            Ok(p) => volume_get(state, volumes, token, p).await,
            Err(e) => Ack::fail("bad_payload", Some(e.to_string())),
        },
        TYPE_VOLUME_SET => match serde_json::from_value::<VolumePayload>(payload) {
            Ok(p) => volume_set(state, volumes, token, p).await,
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

async fn volume_get(
    state: &AppState,
    volumes: &VolumeRegistry,
    token: Option<&str>,
    p: VolumePayload,
) -> Ack {
    let Some(strategy) = volumes.get(&p.decoder) else {
        return Ack::fail("unknown_decoder", Some(p.decoder));
    };
    let cfg = state.config().await;
    if !cfg.enabled {
        return Ack::fail("pc_disabled", None);
    }
    let nums = strategy.read_cvs();
    match state
        .hub
        .read_cvs(cfg.mode, token, p.station_id, p.address, nums, p.track)
        .await
    {
        Ok(batch) => match strategy.decode(&batch.cvs) {
            Some(percent) => Ack::ok_percent(percent, batch.cvs),
            None => Ack::fail("volume_decode_failed", None),
        },
        Err(e) => map_bus(e),
    }
}

async fn volume_set(
    state: &AppState,
    volumes: &VolumeRegistry,
    token: Option<&str>,
    p: VolumePayload,
) -> Ack {
    let Some(percent) = p.percent else {
        return Ack::fail("percent_required", None);
    };
    if !valid_percent(percent) {
        return Ack::fail("invalid_percent", None);
    }
    let Some(strategy) = volumes.get(&p.decoder) else {
        return Ack::fail("unknown_decoder", Some(p.decoder));
    };
    let cfg = state.config().await;
    if !cfg.enabled {
        return Ack::fail("pc_disabled", None);
    }
    let cvs = strategy.encode(percent);
    match state
        .hub
        .write_cvs(cfg.mode, token, p.station_id, p.address, &cvs, p.track)
        .await
    {
        Ok(written) => Ack::ok_percent(percent, written.cvs),
        Err(e) => map_bus(e),
    }
}
