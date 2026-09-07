//! HTTP helpers: public config, OAuth exchange, BigFred reverse proxy.

use axum::body::Body;
use axum::extract::State;
use axum::http::header::HeaderName;
use axum::http::{HeaderMap, HeaderValue, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;

use crate::config::PublicConfig;
use crate::error::{ApiError, ApiResult};
use crate::AppState;

pub async fn public_config(State(state): State<AppState>) -> Json<PublicConfig> {
    Json(state.config().await.public())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenRequest {
    pub code: String,
    pub redirect_uri: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub state: Option<String>,
}

pub async fn oauth_token(
    State(state): State<AppState>,
    Json(body): Json<TokenRequest>,
) -> ApiResult<Json<bigfred_client::TokenResponse>> {
    let cfg = state.config().await;
    if !cfg.mode.is_bigfred() {
        return Err(ApiError::forbidden("standalone_no_sso"));
    }
    if body.code.trim().is_empty() {
        return Err(ApiError::bad_request("missing_code"));
    }
    if !cfg.redirect_uri_allowed(&body.redirect_uri) {
        return Err(ApiError::bad_request("invalid_redirect_uri"));
    }
    let bf = state.bf_cfg.read().await.clone();
    let parsed = bigfred_client::oauth::exchange_token(
        &state.http,
        &bf,
        body.code.trim(),
        body.redirect_uri.trim(),
    )
    .await?;
    Ok(Json(parsed))
}

const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

pub async fn proxy(State(state): State<AppState>, req: Request<Body>) -> Response {
    match forward(state, req).await {
        Ok(res) => res,
        Err(err) => err.into_response(),
    }
}

async fn forward(state: AppState, req: Request<Body>) -> Result<Response, ApiError> {
    let cfg = state.config().await;
    if !cfg.mode.is_bigfred() {
        return Err(ApiError::forbidden("standalone_no_proxy"));
    }
    let (parts, body) = req.into_parts();
    let path = parts.uri.path();
    if path.starts_with("/api/v1/pc/") {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "not_found"));
    }
    if parts
        .headers
        .get(axum::http::header::UPGRADE)
        .is_some_and(|v| !v.is_empty())
    {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "websocket_not_proxied",
        ));
    }

    let bytes = axum::body::to_bytes(body, MAX_BODY_BYTES)
        .await
        .map_err(|err| ApiError::bad_request("body_too_large").with_detail(err.to_string()))?;

    let mut headers = Vec::new();
    for name in bigfred_client::proxy::forwarded_request_header_names() {
        if let Some(value) = parts.headers.get(name) {
            headers.push((name, value.as_bytes()));
        }
    }

    let api_base = state.bf_cfg.read().await.api_base.clone();
    let forwarded = bigfred_client::proxy::forward(
        &state.http,
        &api_base,
        parts.method.as_str(),
        path,
        parts.uri.query(),
        &headers,
        &bytes,
    )
    .await?;

    let status =
        StatusCode::from_u16(forwarded.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut out_headers = HeaderMap::new();
    for (name, value) in forwarded.headers {
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_bytes(&value),
        ) {
            out_headers.insert(name, value);
        }
    }
    Ok((status, out_headers, forwarded.body).into_response())
}
