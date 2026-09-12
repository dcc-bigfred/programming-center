//! Browser WebSocket: Direct CV read / write / bitop.

use std::future::Future;

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
    Ack, AddressSetPayload, CvBitopPayload, CvProgress, CvReadPayload, CvWritePayload, Envelope,
    FirmwareJobPayload, FirmwareUpdatePayload, FunctionSetPayload, TelemetrySubscribePayload,
    TYPE_ACK, TYPE_ADDRESS_SET, TYPE_AUTH, TYPE_CV_BITOP, TYPE_CV_PROGRESS, TYPE_CV_READ,
    TYPE_CV_READ_CANCEL, TYPE_CV_WRITE, TYPE_CV_WRITE_CANCEL, TYPE_FIRMWARE_CANCEL,
    TYPE_FIRMWARE_LIST, TYPE_FIRMWARE_PROGRESS, TYPE_FIRMWARE_SCAN, TYPE_FIRMWARE_STATUS,
    TYPE_FIRMWARE_UPDATE, TYPE_FIRMWARE_WATCH, TYPE_FUNCTION_SET, TYPE_TELEMETRY_CANCEL,
    TYPE_TELEMETRY_SUBSCRIBE, TYPE_TELEMETRY_UPDATE,
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

#[derive(Debug, Deserialize)]
struct AuthPayload {
    #[serde(default)]
    token: Option<String>,
}

pub async fn ws_upgrade(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state, q.token))
}

async fn handle_socket(socket: WebSocket, state: AppState, query_token: Option<String>) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::channel::<Message>(32);
    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    let Some(token) = handshake(&mut stream, &tx, query_token).await else {
        drop(tx);
        let _ = writer.await;
        return;
    };

    let mut queued: Option<Envelope> = None;
    'socket: loop {
        let env = if let Some(next) = queued.take() {
            next
        } else {
            let Some(Ok(msg)) = stream.next().await else {
                break;
            };
            let text = match inbound_text(msg, &tx).await {
                Inbound::Skip => continue,
                Inbound::Closed => break,
                Inbound::Text(t) => t,
            };
            match serde_json::from_str(&text) {
                Ok(e) => e,
                Err(err) => {
                    warn!(error = %err, "bad ws frame");
                    continue;
                }
            }
        };
        if env.kind == TYPE_AUTH {
            continue;
        }
        if env.kind == TYPE_CV_READ_CANCEL
            || env.kind == TYPE_CV_WRITE_CANCEL
            || env.kind == TYPE_TELEMETRY_CANCEL
        {
            let _ = send_envelope(&tx, TYPE_ACK, env.id.clone(), &Ack::ok()).await;
            continue;
        }

        let cancel = CancellationToken::new();
        let req_id = env.id.clone();
        let mut op = std::pin::pin!(dispatch(
            &state,
            token.as_deref(),
            &env,
            cancel.clone(),
            tx.clone(),
        ));
        match supervise(&mut op, &mut stream, &tx, &req_id, &env.kind, &cancel).await {
            Supervise::Ack(ack) => {
                if !send_envelope(&tx, TYPE_ACK, env.id.clone(), &ack).await {
                    break 'socket;
                }
            }
            Supervise::FollowUp(ack, next) => {
                if !send_envelope(&tx, TYPE_ACK, env.id.clone(), &ack).await {
                    break 'socket;
                }
                queued = Some(next);
            }
            Supervise::Closed => break 'socket,
        }
    }
    drop(tx);
    let _ = writer.await;
}

enum Supervise {
    Ack(Ack),
    Closed,
    /// Current op finished; run this next command without waiting for the socket.
    FollowUp(Ack, Envelope),
}

fn replaces_in_flight(current_kind: &str, incoming_kind: &str) -> bool {
    current_kind == TYPE_TELEMETRY_SUBSCRIBE && incoming_kind == TYPE_TELEMETRY_SUBSCRIBE
}

async fn supervise<F>(
    op: &mut F,
    stream: &mut (impl StreamExt<Item = Result<Message, axum::Error>> + Unpin),
    tx: &mpsc::Sender<Message>,
    req_id: &Option<String>,
    current_kind: &str,
    cancel: &CancellationToken,
) -> Supervise
where
    F: Future<Output = Ack> + Unpin,
{
    let mut follow_up = None;
    loop {
        tokio::select! {
            ack = &mut *op => {
                return match follow_up {
                    Some(env) => Supervise::FollowUp(ack, env),
                    None => Supervise::Ack(ack),
                };
            }
            incoming = stream.next() => {
                match incoming {
                    None | Some(Err(_)) | Some(Ok(Message::Close(_))) => {
                        cancel.cancel();
                        return Supervise::Closed;
                    }
                    Some(Ok(Message::Ping(p))) => {
                        if tx.send(Message::Pong(p)).await.is_err() {
                            cancel.cancel();
                            return Supervise::Closed;
                        }
                    }
                    Some(Ok(other)) => {
                        if is_cancel_for(req_id, &other) {
                            cancel.cancel();
                        } else if let Some(env) = parse_envelope(&other) {
                            if env.kind == TYPE_AUTH
                                || env.kind == TYPE_CV_READ_CANCEL
                                || env.kind == TYPE_CV_WRITE_CANCEL
                                || env.kind == TYPE_TELEMETRY_CANCEL
                                || env.kind == TYPE_FIRMWARE_CANCEL
                            {
                                continue;
                            }
                            if replaces_in_flight(current_kind, &env.kind) {
                                cancel.cancel();
                                follow_up = Some(env);
                                continue;
                            }
                            warn!(kind = %env.kind, "rejecting frame during in-flight programming op");
                            let _ = send_envelope(
                                tx,
                                TYPE_ACK,
                                env.id,
                                &Ack::fail("busy", Some("programming in progress".into())),
                            )
                            .await;
                        }
                    }
                }
            }
        }
    }
}

async fn handshake(
    stream: &mut (impl StreamExt<Item = Result<Message, axum::Error>> + Unpin),
    tx: &mpsc::Sender<Message>,
    query_token: Option<String>,
) -> Option<Option<String>> {
    if let Some(token) = query_token.filter(|t| !t.is_empty()) {
        warn!("websocket token in query string is deprecated; send type=auth as the first frame");
        return Some(Some(token));
    }
    loop {
        match stream.next().await {
            None | Some(Err(_)) | Some(Ok(Message::Close(_))) => return None,
            Some(Ok(Message::Ping(p))) => {
                if tx.send(Message::Pong(p)).await.is_err() {
                    return None;
                }
            }
            Some(Ok(msg)) => {
                let text = match inbound_text(msg, tx).await {
                    Inbound::Skip => continue,
                    Inbound::Closed => return None,
                    Inbound::Text(t) => t,
                };
                let Ok(env) = serde_json::from_str::<Envelope>(&text) else {
                    continue;
                };
                if env.kind != TYPE_AUTH {
                    warn!(kind = %env.kind, "expected auth as first websocket frame");
                    return Some(None);
                }
                let payload = env.payload.unwrap_or(serde_json::Value::Null);
                let token = serde_json::from_value::<AuthPayload>(payload)
                    .ok()
                    .and_then(|p| p.token)
                    .filter(|t| !t.is_empty());
                return Some(token);
            }
        }
    }
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

fn parse_envelope(msg: &Message) -> Option<Envelope> {
    let text = match msg {
        Message::Text(t) => t.as_str(),
        Message::Binary(b) => std::str::from_utf8(b).ok()?,
        _ => return None,
    };
    serde_json::from_str(text).ok()
}

fn inbound_envelope(msg: &Message) -> Option<(String, Option<String>)> {
    let env = parse_envelope(msg)?;
    Some((env.kind, env.id))
}

fn is_cancel_for(req_id: &Option<String>, msg: &Message) -> bool {
    let Some((kind, id)) = inbound_envelope(msg) else {
        return false;
    };
    (kind == TYPE_CV_READ_CANCEL
        || kind == TYPE_CV_WRITE_CANCEL
        || kind == TYPE_TELEMETRY_CANCEL
        || kind == TYPE_FIRMWARE_CANCEL)
        && id == *req_id
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

async fn dispatch(
    state: &AppState,
    token: Option<&str>,
    env: &Envelope,
    cancel: CancellationToken,
    tx: mpsc::Sender<Message>,
) -> Ack {
    let payload = env.payload.clone().unwrap_or(serde_json::Value::Null);
    match env.kind.as_str() {
        TYPE_CV_READ => match serde_json::from_value::<CvReadPayload>(payload) {
            Ok(p) => {
                let cfg = state.config().await;
                if cfg.cv_bus().is_z21() {
                    cv_read_standalone(state, token, env, cancel, tx).await
                } else {
                    cv_read(state, token, p, &cancel).await
                }
            }
            Err(e) => Ack::fail("bad_payload", Some(e.to_string())),
        },
        TYPE_CV_WRITE => match serde_json::from_value::<CvWritePayload>(payload) {
            Ok(p) => cv_write(state, token, p, &cancel).await,
            Err(e) => Ack::fail("bad_payload", Some(e.to_string())),
        },
        TYPE_CV_BITOP => match serde_json::from_value::<CvBitopPayload>(payload) {
            Ok(p) => cv_bitop(state, token, p, &cancel).await,
            Err(e) => Ack::fail("bad_payload", Some(e.to_string())),
        },
        TYPE_ADDRESS_SET => match serde_json::from_value::<AddressSetPayload>(payload) {
            Ok(p) => {
                let cfg = state.config().await;
                if !cfg.cv_bus().is_z21() {
                    Ack::fail("z21_required", None)
                } else {
                    crate::address::set(&cfg, &state.hub, token, p, &cancel).await
                }
            }
            Err(e) => Ack::fail("bad_payload", Some(e.to_string())),
        },
        TYPE_TELEMETRY_SUBSCRIBE => {
            match serde_json::from_value::<TelemetrySubscribePayload>(payload) {
                Ok(p) => telemetry_subscribe(state, env, p, cancel, tx).await,
                Err(e) => Ack::fail("bad_payload", Some(e.to_string())),
            }
        }
        TYPE_FUNCTION_SET => match serde_json::from_value::<FunctionSetPayload>(payload) {
            Ok(p) => {
                let cfg = state.config().await;
                crate::firmware::set_function(&cfg, &state.hub, token, p, &cancel).await
            }
            Err(e) => Ack::fail("bad_payload", Some(e.to_string())),
        },
        TYPE_FIRMWARE_STATUS => {
            let cfg = state.config().await;
            crate::firmware::status(&cfg, &state.wp)
        }
        TYPE_FIRMWARE_LIST => {
            let cfg = state.config().await;
            crate::firmware::list(&cfg, state)
        }
        TYPE_FIRMWARE_SCAN => {
            let cfg = state.config().await;
            crate::firmware::scan(&cfg, state).await
        }
        TYPE_FIRMWARE_UPDATE => match serde_json::from_value::<FirmwareUpdatePayload>(payload) {
            Ok(p) => {
                let cfg = state.config().await;
                crate::firmware::update(&cfg, state, p).await
            }
            Err(e) => Ack::fail("bad_payload", Some(e.to_string())),
        },
        TYPE_FIRMWARE_WATCH => match serde_json::from_value::<FirmwareJobPayload>(payload) {
            Ok(p) => firmware_watch(state, env, p, cancel, tx).await,
            Err(e) => Ack::fail("bad_payload", Some(e.to_string())),
        },
        TYPE_FIRMWARE_CANCEL => match serde_json::from_value::<FirmwareJobPayload>(payload) {
            Ok(p) => {
                let cfg = state.config().await;
                crate::firmware::cancel_job(&cfg, state, p).await
            }
            Err(e) => Ack::fail("bad_payload", Some(e.to_string())),
        },
        other => Ack::fail("unknown_command", Some(other.to_string())),
    }
}

async fn firmware_watch(
    state: &AppState,
    env: &Envelope,
    p: FirmwareJobPayload,
    cancel: CancellationToken,
    tx: mpsc::Sender<Message>,
) -> Ack {
    let cfg = state.config().await;
    let (out_tx, mut out_rx) = mpsc::channel(8);
    let id = env.id.clone();
    let fwd = tokio::spawn(async move {
        while let Some(update) = out_rx.recv().await {
            if !send_envelope(&tx, TYPE_FIRMWARE_PROGRESS, id.clone(), &update).await {
                break;
            }
        }
    });
    let ack = crate::firmware::watch(&cfg, state, p, cancel, out_tx).await;
    fwd.abort();
    ack
}

async fn telemetry_subscribe(
    state: &AppState,
    env: &Envelope,
    p: TelemetrySubscribePayload,
    cancel: CancellationToken,
    tx: mpsc::Sender<Message>,
) -> Ack {
    let cfg = state.config().await;
    let (out_tx, mut out_rx) = mpsc::channel(8);
    let id = env.id.clone();
    let fwd = tokio::spawn(async move {
        while let Some(update) = out_rx.recv().await {
            if !send_envelope(&tx, TYPE_TELEMETRY_UPDATE, id.clone(), &update).await {
                break;
            }
        }
    });
    let ack = crate::telemetry::subscribe(&cfg, &state.hub, p, &cancel, out_tx).await;
    fwd.abort();
    ack
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
    cancel: Option<&CancellationToken>,
) -> Result<u8, ApiError> {
    let cfg = state.config().await;
    let batch = state
        .hub
        .read_cvs(
            cfg.cv_bus(),
            token,
            station_id,
            address,
            &[1],
            track,
            cancel,
        )
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
    cancel: &CancellationToken,
) -> Result<CvBatch, ApiError> {
    if cvs.is_empty() {
        return Ok(CvBatch::default());
    }
    let cfg = state.config().await;
    if cfg.cv_bus().is_z21() || cvs.len() <= DCC_BUS_CHUNK {
        return state
            .hub
            .read_cvs(
                cfg.cv_bus(),
                token,
                station_id,
                address,
                cvs,
                track,
                Some(cancel),
            )
            .await;
    }
    let mut out = CvBatch::default();
    for chunk in cvs.chunks(DCC_BUS_CHUNK) {
        if cancel.is_cancelled() {
            return Err(ApiError::cancelled());
        }
        out.merge(
            state
                .hub
                .read_cvs(
                    cfg.cv_bus(),
                    token,
                    station_id,
                    address,
                    chunk,
                    track,
                    Some(cancel),
                )
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
    cancel: &CancellationToken,
) -> Result<CvBatch, ApiError> {
    if cvs.is_empty() {
        return Ok(CvBatch::default());
    }
    let cfg = state.config().await;
    if cfg.cv_bus().is_z21() || cvs.len() <= DCC_BUS_CHUNK {
        return state
            .hub
            .write_cvs(
                cfg.cv_bus(),
                token,
                station_id,
                address,
                cvs,
                track,
                Some(cancel),
            )
            .await;
    }
    let mut out = CvBatch::default();
    for chunk in cvs.chunks(DCC_BUS_CHUNK) {
        if cancel.is_cancelled() {
            return Err(ApiError::cancelled());
        }
        out.merge(
            state
                .hub
                .write_cvs(
                    cfg.cv_bus(),
                    token,
                    station_id,
                    address,
                    chunk,
                    track,
                    Some(cancel),
                )
                .await?,
        );
    }
    Ok(out)
}

async fn cv_read(
    state: &AppState,
    token: Option<&str>,
    p: CvReadPayload,
    cancel: &CancellationToken,
) -> Ack {
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
        match probe_cv1(state, token, p.station_id, p.address, p.track, Some(cancel)).await {
            Ok(value) => {
                if nums.contains(&1) {
                    batch.cvs.push(CvEntry { cv: 1, value });
                    nums.retain(|n| *n != 1);
                }
            }
            Err(e) => return map_bus(e),
        }
    }
    match read_chunked(
        state,
        token,
        p.station_id,
        p.address,
        &nums,
        p.track,
        cancel,
    )
    .await
    {
        Ok(part) => batch.merge(part),
        Err(e) => return map_bus(e),
    }
    finish_read(dump, batch)
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
        match probe_cv1(
            state,
            token,
            p.station_id,
            p.address,
            p.track,
            Some(&cancel),
        )
        .await
        {
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

async fn cv_write(
    state: &AppState,
    token: Option<&str>,
    p: CvWritePayload,
    cancel: &CancellationToken,
) -> Ack {
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
        if let Err(e) =
            probe_cv1(state, token, p.station_id, p.address, p.track, Some(cancel)).await
        {
            return map_bus(e);
        }
    }
    match write_chunked(
        state,
        token,
        p.station_id,
        p.address,
        &p.cvs,
        p.track,
        cancel,
    )
    .await
    {
        Ok(batch) => Ack::ok_batch(batch.cvs, batch.errors),
        Err(e) => map_bus(e),
    }
}

async fn cv_bitop(
    state: &AppState,
    token: Option<&str>,
    p: CvBitopPayload,
    cancel: &CancellationToken,
) -> Ack {
    if !valid_cv(p.cv) {
        return Ack::fail("invalid_cv", None);
    }
    let cfg = state.config().await;
    if !cfg.enabled {
        return Ack::fail("pc_disabled", None);
    }
    let read = match state
        .hub
        .read_cvs(
            cfg.cv_bus(),
            token,
            p.station_id,
            p.address,
            &[p.cv],
            p.track,
            Some(cancel),
        )
        .await
    {
        Ok(v) => v,
        Err(e) => return map_bus(e),
    };
    let Some(old) = read.cvs.iter().find(|e| e.cv == p.cv) else {
        return Ack::fail("programming_failed", Some("empty read".into()));
    };
    let new_val = apply_bitop(old.value, p.and_mask, p.or_mask);
    let entry = CvEntry {
        cv: p.cv,
        value: new_val,
    };
    match state
        .hub
        .write_cvs(
            cfg.cv_bus(),
            token,
            p.station_id,
            p.address,
            &[entry],
            p.track,
            Some(cancel),
        )
        .await
    {
        Ok(batch) if batch.errors.is_empty() && batch.cvs.iter().any(|e| e.cv == p.cv) => {
            Ack::ok_cvs(batch.cvs)
        }
        Ok(_) => Ack::fail(
            "programming_failed",
            Some(format!("CV{} not written", p.cv)),
        ),
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
        assert!(is_cancel_for(
            &id,
            &text(r#"{"type":"cv.write.cancel","id":"req-1"}"#),
        ));
        assert!(!is_cancel_for(
            &id,
            &text(r#"{"type":"cv.read.cancel","id":"other"}"#),
        ));
        assert!(!is_cancel_for(
            &id,
            &text(r#"{"type":"cv.write","id":"req-1"}"#),
        ));
        assert!(is_cancel_for(
            &id,
            &text(r#"{"type":"telemetry.cancel","id":"req-1"}"#),
        ));
        assert!(is_cancel_for(
            &id,
            &text(r#"{"type":"firmware.cancel","id":"req-1"}"#),
        ));
        assert!(!is_cancel_for(&id, &Message::Ping(Vec::new())));
    }

    #[test]
    fn telemetry_subscribe_replaces_in_flight_telemetry() {
        assert!(replaces_in_flight(
            TYPE_TELEMETRY_SUBSCRIBE,
            TYPE_TELEMETRY_SUBSCRIBE
        ));
        assert!(!replaces_in_flight(TYPE_TELEMETRY_SUBSCRIBE, TYPE_CV_READ));
        assert!(!replaces_in_flight(TYPE_CV_READ, TYPE_TELEMETRY_SUBSCRIBE));
    }

    #[test]
    fn inbound_envelope_reads_type() {
        assert_eq!(
            inbound_envelope(&text(r#"{"type":"cv.write","id":"1"}"#))
                .map(|(kind, _)| kind)
                .as_deref(),
            Some("cv.write")
        );
        assert_eq!(inbound_envelope(&Message::Ping(Vec::new())), None);
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
