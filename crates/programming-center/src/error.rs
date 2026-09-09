//! JSON error envelope `{ "error", "detail?" }` — same as BigFred / wizard.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: String,
    /// Server-side only (SQL, paths, upstream). Never sent to the tablet.
    pub detail: Option<String>,
    /// Safe to show on the LAN kiosk.
    pub public_detail: Option<String>,
}

impl ApiError {
    pub fn new(status: StatusCode, code: impl Into<String>) -> Self {
        Self {
            status,
            code: code.into(),
            detail: None,
            public_detail: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn with_public_detail(mut self, detail: impl Into<String>) -> Self {
        self.public_detail = Some(detail.into());
        self
    }

    pub fn bad_request(code: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, code)
    }

    pub fn cancelled() -> Self {
        Self::new(StatusCode::BAD_REQUEST, "cancelled")
    }

    pub fn unauthorized() -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "unauthorized")
    }

    pub fn unavailable(code: impl Into<String>) -> Self {
        Self::new(StatusCode::SERVICE_UNAVAILABLE, code)
    }

    pub fn internal(code: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, code)
    }

    pub fn not_found() -> Self {
        Self::new(StatusCode::NOT_FOUND, "not_found")
    }

    pub fn forbidden(code: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, code)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        if let Some(detail) = &self.detail {
            tracing::warn!(code = %self.code, %detail, "api error");
        }
        let mut body = json!({ "error": self.code });
        if let Some(detail) = self.public_detail {
            body["detail"] = json!(detail);
        }
        (self.status, Json(body)).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

impl From<bigfred_client::Error> for ApiError {
    fn from(err: bigfred_client::Error) -> Self {
        use bigfred_client::Error as E;
        match err {
            E::OauthUnreachable(d) | E::ProxyUnreachable(d) => {
                ApiError::unavailable("bigfred_unreachable").with_detail(d)
            }
            E::ProxyReadFailed(d) => ApiError::unavailable("bigfred_read_failed").with_detail(d),
            E::DccBusUnreachable(d) => {
                let mut out = ApiError::unavailable("dcc_bus_unavailable");
                if !d.is_empty() {
                    out = out.with_detail(d);
                }
                out
            }
            E::Unauthorized => ApiError::unauthorized(),
            E::ProgrammingTimeout => {
                ApiError::new(StatusCode::GATEWAY_TIMEOUT, "programming_timeout")
            }
            E::FunctionOffTimeout => {
                ApiError::new(StatusCode::GATEWAY_TIMEOUT, "function_off_timeout")
            }
            E::BadStatus {
                status,
                code,
                detail,
            } => {
                let mut out = ApiError::new(
                    StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                    code,
                );
                if let Some(d) = detail {
                    out = out.with_detail(d);
                }
                out
            }
            E::OauthBadResponse(d) => ApiError::internal("oauth_bad_response").with_detail(d),
            E::CatalogueUnavailable(d) => {
                ApiError::unavailable("catalogue_unavailable").with_detail(d)
            }
            E::CatalogueBadResponse(d) => {
                ApiError::internal("catalogue_bad_response").with_detail(d)
            }
            E::OauthClientEnsureFailed(d) => {
                ApiError::internal("oauth_client_ensure_failed").with_detail(d)
            }
            E::OauthClientUnreadable(d) => {
                ApiError::internal("oauth_client_unreadable").with_detail(d)
            }
            E::OauthClientMissing => ApiError::internal("oauth_client_missing"),
            E::NoProgrammingStation => ApiError::unavailable("no_programming_station"),
            E::DccBusSessionLost => ApiError::internal("dcc_bus_session_lost"),
            E::DccBusDriveSessionLost => ApiError::internal("dcc_bus_drive_session_lost"),
            E::DccBusPendingPoisoned => ApiError::internal("dcc_bus_pending_poisoned"),
            E::DccBusBadUrl(d) => ApiError::internal("dcc_bus_bad_url").with_detail(d),
            E::FrameEncodeFailed(d) => ApiError::internal("frame_encode_failed").with_detail(d),
            E::ImpersonateRequired => ApiError::bad_request("impersonate_required"),
            E::InvalidImpersonateLogin => ApiError::bad_request("invalid_impersonate_login"),
            E::Io { path, source } => ApiError::internal("oauth_client_unreadable")
                .with_detail(format!("io {}: {source}", path.display())),
            E::Parse { path, source } => ApiError::internal("oauth_client_unreadable")
                .with_detail(format!("parse {}: {source}", path.display())),
            E::Serialize { path, source } => ApiError::internal("oauth_client_unreadable")
                .with_detail(format!("serialize {}: {source}", path.display())),
        }
    }
}

impl ApiError {
    #[must_use]
    pub fn into_ack(self) -> pc_proto::Ack {
        if let Some(detail) = &self.detail {
            tracing::warn!(code = %self.code, %detail, "ack error");
        }
        pc_proto::Ack::fail(self.code, self.public_detail)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_upstream() {
        let err: ApiError = bigfred_client::Error::BadStatus {
            status: 403,
            code: "forbidden".into(),
            detail: Some("no".into()),
        }
        .into();
        assert_eq!(err.status, StatusCode::FORBIDDEN);
        assert_eq!(err.code, "forbidden");
    }
}
