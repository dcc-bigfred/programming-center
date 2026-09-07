//! Runtime JSON: `$DATA_DIR/etc/bigfred/programming-center/config.json`.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use bigfred_shared_daemon::config::{JsonFile, Load};
use bigfred_shared_daemon::{DataDir, EnvPolicy, PathRule};

pub const DEFAULT_PORT: u16 = 8092;
pub const VITE_DEV_PORT: u16 = 5176;

pub const BUILTIN_REDIRECT_URIS: &[&str] = &[
    "http://bigfred.local:8092/auth/callback",
    "http://programming-center.local:8092/auth/callback",
    "http://localhost:8092/auth/callback",
];

#[derive(Debug, Clone, Copy, Deserialize, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IntegrationMode {
    #[default]
    Bigfred,
    Standalone,
}

impl IntegrationMode {
    #[must_use]
    pub fn is_standalone(self) -> bool {
        matches!(self, Self::Standalone)
    }

    #[must_use]
    pub fn is_bigfred(self) -> bool {
        matches!(self, Self::Bigfred)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct BigfredSection {
    /// Host:port without scheme, e.g. `bigfred.local:8080`.
    pub address: String,
}

impl Default for BigfredSection {
    fn default() -> Self {
        Self {
            address: "bigfred.local:8080".into(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Z21Section {
    pub hostname: String,
    pub port: u16,
}

impl Default for Z21Section {
    fn default() -> Self {
        Self {
            hostname: "192.168.4.1".into(),
            port: 21150,
        }
    }
}

impl Z21Section {
    #[must_use]
    pub fn is_configured(&self) -> bool {
        !self.hostname.trim().is_empty() && self.port != 0
    }

    /// Resolve hostname:port to a UDP socket address.
    pub fn socket_addr(&self) -> Result<SocketAddr, String> {
        use std::net::ToSocketAddrs;
        let host = self.hostname.trim();
        (host, self.port)
            .to_socket_addrs()
            .map_err(|e| e.to_string())?
            .next()
            .ok_or_else(|| format!("no address for {host}:{}", self.port))
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub http: String,
    pub enabled: bool,
    pub mode: IntegrationMode,
    pub bigfred: BigfredSection,
    pub z21: Z21Section,
    pub sso_client_id: String,
    pub redirect_uris: Vec<String>,
    pub cors_enabled: bool,
    pub cors_origins: Vec<String>,
    pub idle_timeout_secs: u64,
}

impl Default for Config {
    fn default() -> Self {
        let mut redirect_uris = Vec::new();
        merge_builtin_redirect_uris(&mut redirect_uris);
        Self {
            http: format!("0.0.0.0:{DEFAULT_PORT}"),
            enabled: false,
            mode: IntegrationMode::Bigfred,
            bigfred: BigfredSection::default(),
            z21: Z21Section::default(),
            sso_client_id: "programming-center".into(),
            redirect_uris,
            cors_enabled: false,
            cors_origins: Vec::new(),
            idle_timeout_secs: 86_400,
        }
    }
}

pub fn merge_builtin_redirect_uris(uris: &mut Vec<String>) {
    for builtin in BUILTIN_REDIRECT_URIS {
        if !uris.iter().any(|u| u.trim() == *builtin) {
            uris.push((*builtin).to_string());
        }
    }
    for host in ["bigfred.local", "localhost"] {
        let vite = format!("http://{host}:{VITE_DEV_PORT}/auth/callback");
        if !uris.iter().any(|u| u.trim() == vite) {
            uris.push(vite);
        }
    }
}

fn trim_slash(s: &str) -> String {
    s.trim().trim_end_matches('/').to_string()
}

/// Parse `host:port` or `http://host:port` into HTTP origin without trailing slash.
pub fn http_origin(address: &str) -> String {
    let a = address.trim();
    if a.starts_with("http://") || a.starts_with("https://") {
        return trim_slash(a);
    }
    format!("http://{}", a.trim_start_matches('/'))
}

pub fn ws_origin(http: &str) -> String {
    let base = trim_slash(http);
    if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        format!("ws://{base}")
    }
}

impl Config {
    pub fn load_or_seed(path: &Path) -> Result<Self, String> {
        let loader = JsonFile::<Config>::new(path).create_default();
        let mut cfg = loader.load().map_err(|e| e.to_string())?;
        merge_builtin_redirect_uris(&mut cfg.redirect_uris);
        Ok(cfg)
    }

    #[must_use]
    pub fn public(&self) -> PublicConfig {
        PublicConfig {
            enabled: self.enabled,
            mode: self.mode,
            sso_client_id: self.sso_client_id.clone(),
            redirect_uris: self.redirect_uris.clone(),
            idle_timeout_secs: self.idle_timeout_secs,
            station_picker: self.mode.is_bigfred(),
            login_required: self.mode.is_bigfred(),
            bigfred_public_url: if self.mode.is_bigfred() {
                Some(self.bigfred_api_base())
            } else {
                None
            },
            z21: if self.mode.is_standalone() {
                Some(Z21Public {
                    hostname: self.z21.hostname.trim().to_string(),
                    port: self.z21.port,
                })
            } else {
                None
            },
        }
    }

    #[must_use]
    pub fn bigfred_api_base(&self) -> String {
        http_origin(&self.bigfred.address)
    }

    #[must_use]
    pub fn bigfred_ws_base(&self) -> String {
        ws_origin(&self.bigfred_api_base())
    }

    #[must_use]
    pub fn bigfred_view(&self, data_dir: &DataDir) -> bigfred_client::BigFredConfig {
        bigfred_client::BigFredConfig {
            api_base: self.bigfred_api_base(),
            ws_base: self.bigfred_ws_base(),
            sso_client_id: self.sso_client_id.clone(),
            redirect_uris: self.redirect_uris.clone(),
            oauth_dropin_dir: data_dir.join(["etc", "bigfred", "oauth-clients"]),
            oauth_display_name: "Programming Center".into(),
            fixed_dcc_bus: None,
        }
    }

    #[must_use]
    pub fn redirect_uri_allowed(&self, uri: &str) -> bool {
        let uri = uri.trim();
        self.redirect_uris.iter().any(|u| u.trim() == uri)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Z21Public {
    pub hostname: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicConfig {
    pub enabled: bool,
    pub mode: IntegrationMode,
    pub sso_client_id: String,
    pub redirect_uris: Vec<String>,
    pub idle_timeout_secs: u64,
    pub station_picker: bool,
    pub login_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bigfred_public_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub z21: Option<Z21Public>,
}

#[must_use]
pub fn resolve_data_dir() -> DataDir {
    DataDir::resolve(EnvPolicy::BigfredThenDataDir, PathRule::AcceptAny)
}

#[must_use]
pub fn default_config_path(data_dir: &DataDir) -> PathBuf {
    data_dir.join(["etc", "bigfred", "programming-center", "config.json"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_bigfred_at_local() {
        let cfg = Config::default();
        assert_eq!(cfg.mode, IntegrationMode::Bigfred);
        assert_eq!(cfg.bigfred.address, "bigfred.local:8080");
        assert_eq!(cfg.z21.hostname, "192.168.4.1");
        assert_eq!(cfg.z21.port, 21150);
        assert!(!cfg.enabled);
        assert!(cfg.redirect_uri_allowed("http://bigfred.local:8092/auth/callback"));
        assert_eq!(cfg.bigfred_api_base(), "http://bigfred.local:8080");
        assert_eq!(cfg.bigfred_ws_base(), "ws://bigfred.local:8080");
    }

    #[test]
    fn http_origin_accepts_bare_and_scheme() {
        assert_eq!(http_origin("127.0.0.1:8080"), "http://127.0.0.1:8080");
        assert_eq!(http_origin("http://x:1/"), "http://x:1");
    }

    #[test]
    fn public_hides_picker_in_standalone() {
        let cfg = Config {
            mode: IntegrationMode::Standalone,
            ..Config::default()
        };
        let p = cfg.public();
        assert!(!p.station_picker);
        assert!(!p.login_required);
        assert!(p.bigfred_public_url.is_none());
        assert_eq!(p.z21.as_ref().map(|z| z.port), Some(21150));
    }

    #[test]
    fn public_exposes_sso_url_in_bigfred() {
        let p = Config::default().public();
        assert_eq!(
            p.bigfred_public_url.as_deref(),
            Some("http://bigfred.local:8080")
        );
        assert!(p.station_picker);
        assert!(p.login_required);
    }
}
