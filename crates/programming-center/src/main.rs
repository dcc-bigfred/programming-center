//! programming-center — decoder programming kiosk in front of BigFred (or Z21).
//!
//! Memory profile: **allocation-conscious** (HTTP/tokio kiosk).

mod address;
mod bus;
mod changelists;
mod config;
mod db;
mod error;
mod firmware;
mod http;
mod models;
mod schema;
mod telemetry;
mod wp;
mod ws;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderValue, Method, Request, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::Router;
use clap::Parser;
use rust_embed::RustEmbed;
use tokio::sync::RwLock;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

use bigfred_shared_daemon::config::{JsonFile, Load, WatchSpec, DEFAULT_DEBOUNCE};
use bigfred_shared_daemon::DataDir;

use crate::bus::Hub;
use crate::config::{apply_redirect_merges, Config};
use crate::db::Db;

/// Production SPA bundle. `make web-build` fills this directory.
#[derive(RustEmbed)]
#[folder = "../../web/dist"]
struct Assets;

#[derive(Debug, Parser)]
#[command(
    name = "programming-center",
    about = "BigFred decoder programming kiosk"
)]
struct Args {
    /// Config file; defaults to $DATA_DIR/etc/bigfred/programming-center/config.json.
    #[arg(long)]
    config: Option<PathBuf>,
    /// Overrides `http` from the config file.
    #[arg(long)]
    http: Option<String>,
}

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<RwLock<Config>>,
    pub bf_cfg: Arc<RwLock<bigfred_client::BigFredConfig>>,
    pub http: reqwest::Client,
    pub hub: Hub,
    pub db: Db,
    pub wp: Arc<crate::wp::WpLink>,
    pub data_dir: DataDir,
}

impl AppState {
    pub async fn config(&self) -> Config {
        self.cfg.read().await.clone()
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,tower_http=info".into()),
        )
        .init();

    let args = Args::parse();
    let data_dir = config::resolve_data_dir();
    let config_path = args
        .config
        .unwrap_or_else(|| config::default_config_path(&data_dir));
    let http_override = args.http.clone();
    let mut cfg = Config::load_or_seed(&config_path).map_err(|e| e.to_string())?;
    if let Some(ref http) = http_override {
        cfg.http = http.clone();
    }

    if cfg.mode.is_bigfred() {
        match bigfred_client::oauth::ensure_dropin(&cfg.bigfred_view(&data_dir)) {
            Ok(path) => tracing::info!(path = %path.display(), "oauth client ready"),
            Err(err) => tracing::error!(error = %err, "oauth client drop-in unavailable"),
        }
    }

    let addr: SocketAddr = cfg.http.parse()?;
    let listen_http = cfg.http.clone();
    let cors_enabled = cfg.cors_enabled;
    let cors_origins = cfg.cors_origins.clone();
    let enabled = cfg.enabled;
    let mode = cfg.mode;
    let programming_mode = cfg.cv_bus();
    let bigfred = cfg.bigfred_api_base();
    let z21 = format!("{}:{}", cfg.z21.hostname.trim(), cfg.z21.port);

    let cfg = Arc::new(RwLock::new(cfg));
    let bf_cfg = Arc::new(RwLock::new(cfg.read().await.bigfred_view(&data_dir)));
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let dcc = Arc::new(bigfred_client::DccBusClient::new(
        Arc::clone(&bf_cfg),
        http.clone(),
    ));
    let hub = Hub::new(Arc::clone(&dcc), Arc::clone(&cfg));
    let db_path = db::default_db_path(&data_dir);
    let db = db::open(&db_path).map_err(|err| match err.detail {
        Some(detail) => format!("{}: {detail}", err.code),
        None => err.code,
    })?;
    tracing::info!(path = %db_path.display(), "sqlite ready");
    let wp = crate::wp::WpLink::spawn(Arc::clone(&cfg));
    let state = AppState {
        cfg: Arc::clone(&cfg),
        bf_cfg: Arc::clone(&bf_cfg),
        http,
        hub: hub.clone(),
        db,
        wp,
        data_dir: data_dir.clone(),
    };

    let watch_stop = spawn_config_reloader(
        config_path.clone(),
        Arc::clone(&cfg),
        Arc::clone(&bf_cfg),
        hub,
        data_dir,
        http_override,
        listen_http.clone(),
        cors_enabled,
        cors_origins.clone(),
    );

    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(
        %addr,
        enabled,
        ?mode,
        ?programming_mode,
        bigfred = %bigfred,
        z21 = %z21,
        "programming-center listening"
    );
    axum::serve(listener, router(state, cors_enabled, &cors_origins))
        .with_graceful_shutdown(async move {
            shutdown_signal().await;
            watch_stop.store(true, std::sync::atomic::Ordering::SeqCst);
        })
        .await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn spawn_config_reloader(
    config_path: PathBuf,
    cfg: Arc<RwLock<Config>>,
    bf_cfg: Arc<RwLock<bigfred_client::BigFredConfig>>,
    hub: Hub,
    data_dir: DataDir,
    http_override: Option<String>,
    bound_http: String,
    bound_cors_enabled: bool,
    bound_cors_origins: Vec<String>,
) -> Arc<std::sync::atomic::AtomicBool> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let path_for_watch = config_path.clone();
    let stop = match bigfred_shared_daemon::config::spawn_callback(
        vec![WatchSpec::file(path_for_watch)],
        DEFAULT_DEBOUNCE,
        move || {
            let _ = tx.send(());
        },
    ) {
        Ok(s) => s,
        Err(err) => {
            tracing::warn!(error = %err, "config watcher unavailable — hot-reload disabled");
            return Arc::new(std::sync::atomic::AtomicBool::new(false));
        }
    };

    tokio::spawn(async move {
        while rx.recv().await.is_some() {
            let loader = JsonFile::<Config>::new(&config_path);
            match loader.load() {
                Ok(mut new_cfg) => {
                    apply_redirect_merges(&mut new_cfg);
                    if let Some(ref http) = http_override {
                        new_cfg.http = http.clone();
                    }
                    if new_cfg.http != bound_http {
                        tracing::warn!(
                            configured = %new_cfg.http,
                            bound = %bound_http,
                            "http listen address changed in config — restart required to rebind"
                        );
                    }
                    if new_cfg.cors_enabled != bound_cors_enabled
                        || new_cfg.cors_origins != bound_cors_origins
                    {
                        tracing::warn!(
                            "cors settings changed in config — restart required to apply CorsLayer"
                        );
                    }
                    let view = new_cfg.bigfred_view(&data_dir);
                    let mode = new_cfg.mode;
                    let programming_mode = new_cfg.cv_bus();
                    let z21 = format!("{}:{}", new_cfg.z21.hostname.trim(), new_cfg.z21.port);
                    {
                        let mut guard = cfg.write().await;
                        *guard = new_cfg.clone();
                    }
                    *bf_cfg.write().await = view.clone();
                    hub.drop_z21();
                    tracing::info!(
                        path = %config_path.display(),
                        ?mode,
                        ?programming_mode,
                        z21 = %z21,
                        "config reloaded"
                    );
                    if mode.is_bigfred() {
                        match bigfred_client::oauth::ensure_dropin(&view) {
                            Ok(path) => tracing::info!(
                                path = %path.display(),
                                "oauth client synced after reload"
                            ),
                            Err(err) => tracing::error!(
                                error = %err,
                                "oauth client drop-in unavailable after reload"
                            ),
                        }
                    }
                }
                Err(err) => {
                    tracing::warn!(
                        error = %err,
                        path = %config_path.display(),
                        "config reload failed — keeping previous config"
                    );
                }
            }
        }
    });

    stop
}

fn router(state: AppState, cors_enabled: bool, cors_origins: &[String]) -> Router {
    let mut app = Router::new()
        .route("/healthz", get(healthz))
        .route("/api/v1/pc/config", get(http::public_config))
        .route("/api/v1/pc/oauth/token", post(http::oauth_token))
        .route("/api/v1/pc/ws", get(ws::ws_upgrade))
        .route(
            "/api/v1/pc/changelists",
            get(changelists::list).post(changelists::create),
        )
        .route(
            "/api/v1/pc/changelists/:id",
            patch(changelists::replace).delete(changelists::delete),
        )
        .fallback(dispatch)
        .layer(TraceLayer::new_for_http().make_span_with(|req: &Request<_>| {
            tracing::info_span!("http", method = %req.method(), path = %req.uri().path())
        }));

    if cors_enabled && !cors_origins.is_empty() {
        let origins: Vec<HeaderValue> = cors_origins
            .iter()
            .filter_map(|o| HeaderValue::from_str(o).ok())
            .collect();
        if !origins.is_empty() {
            app = app.layer(
                CorsLayer::new()
                    .allow_origin(AllowOrigin::list(origins))
                    .allow_methods([
                        Method::GET,
                        Method::POST,
                        Method::PUT,
                        Method::PATCH,
                        Method::DELETE,
                        Method::OPTIONS,
                    ])
                    .allow_headers([
                        header::CONTENT_TYPE,
                        header::AUTHORIZATION,
                        header::HeaderName::from_static(bigfred_client::IMPERSONATE_HEADER),
                    ]),
            );
        }
    }

    app.with_state(state)
}

async fn healthz() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

async fn dispatch(State(state): State<AppState>, req: Request<Body>) -> Response {
    if req.uri().path().starts_with("/api/v1/") {
        return http::proxy(State(state), req).await;
    }
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    serve_spa(req.uri())
}

fn serve_spa(uri: &Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let candidate = if path.is_empty() { "index.html" } else { path };
    if let Some(res) = embedded(candidate) {
        return res;
    }
    match embedded("index.html") {
        Some(res) => res,
        None => (
            StatusCode::NOT_FOUND,
            "programming-center: SPA bundle missing — run `make web-build`",
        )
            .into_response(),
    }
}

fn embedded(path: &str) -> Option<Response> {
    let file = Assets::get(path)?;
    let mime = file.metadata.mimetype().to_string();
    let cache = if path == "index.html" {
        "no-cache"
    } else if path.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "public, max-age=3600"
    };
    let mut res = Response::new(Body::from(file.data.into_owned()));
    if let Ok(v) = HeaderValue::from_str(&mime) {
        res.headers_mut().insert(header::CONTENT_TYPE, v);
    }
    if let Ok(v) = HeaderValue::from_str(cache) {
        res.headers_mut().insert(header::CACHE_CONTROL, v);
    }
    Some(res)
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        let mut sig = match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            Ok(s) => s,
            Err(_) => std::future::pending().await,
        };
        sig.recv().await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }
}
