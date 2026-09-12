//! Runtime JSON: `$DATA_DIR/etc/bigfred/programming-center/config.json`.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
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

/// SSO / BigFred integration. Independent of [`ProgrammingMode`].
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

/// CV transport. Independent of [`IntegrationMode`].
#[derive(Debug, Clone, Copy, Deserialize, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProgrammingMode {
    /// BigFred dcc-bus (default).
    #[default]
    Bigfred,
    /// Direct UDP to a Z21 / RailBOX.
    #[serde(rename = "z21")]
    Z21,
}

impl ProgrammingMode {
    #[must_use]
    pub fn is_z21(self) -> bool {
        matches!(self, Self::Z21)
    }

    #[must_use]
    pub fn is_dcc_bus(self) -> bool {
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

/// IPC to the wireless-programmer daemon (RB23xx Soft-AP firmware).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct WirelessProgrammerSection {
    pub enabled: bool,
    /// Seconds between IPC `hello` attempts when the socket is down.
    pub socket_connect_retry_interval: u64,
}

impl Default for WirelessProgrammerSection {
    fn default() -> Self {
        Self {
            enabled: true,
            socket_connect_retry_interval: 60,
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
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Config {
    pub http: String,
    pub enabled: bool,
    /// SSO: BigFred login vs none.
    pub mode: IntegrationMode,
    /// CV transport: dcc-bus vs Z21 UDP.
    pub programming_mode: ProgrammingMode,
    pub bigfred: BigfredSection,
    pub z21: Z21Section,
    pub sso_client_id: String,
    pub redirect_uris: Vec<String>,
    pub cors_enabled: bool,
    pub cors_origins: Vec<String>,
    pub idle_timeout_secs: u64,
    /// Allow `http://<ip|*.local>:5176/auth/callback` (Vite on LAN). Off in production.
    pub dev_redirect_uris: bool,
    /// Send each POM write twice. POM has no acknowledgement, so a lost
    /// packet is otherwise silent. Turn off to send exactly one packet.
    pub pom_write_repeat: bool,
    pub wireless_programmer: WirelessProgrammerSection,
}

impl Default for Config {
    fn default() -> Self {
        let mut redirect_uris = Vec::new();
        merge_builtin_redirect_uris(&mut redirect_uris);
        Self {
            http: format!("0.0.0.0:{DEFAULT_PORT}"),
            enabled: false,
            mode: IntegrationMode::Bigfred,
            programming_mode: ProgrammingMode::Bigfred,
            bigfred: BigfredSection::default(),
            z21: Z21Section::default(),
            sso_client_id: "programming-center".into(),
            redirect_uris,
            cors_enabled: false,
            cors_origins: Vec::new(),
            idle_timeout_secs: 86_400,
            dev_redirect_uris: false,
            pom_write_repeat: true,
            wireless_programmer: WirelessProgrammerSection::default(),
        }
    }
}

pub fn merge_builtin_redirect_uris(uris: &mut Vec<String>) {
    for builtin in BUILTIN_REDIRECT_URIS {
        push_unique(uris, (*builtin).to_string());
    }
}

pub fn apply_redirect_merges(cfg: &mut Config) {
    merge_builtin_redirect_uris(&mut cfg.redirect_uris);
    if cfg.dev_redirect_uris {
        merge_vite_redirect_uris(&mut cfg.redirect_uris);
    }
}

fn merge_vite_redirect_uris(uris: &mut Vec<String>) {
    for host in ["bigfred.local", "localhost"] {
        push_unique(uris, dev_vite_redirect_uri(host));
    }
    merge_lan_vite_redirect_uris(uris);
}

fn push_unique(uris: &mut Vec<String>, uri: String) {
    if !uris.iter().any(|u| u.trim() == uri) {
        uris.push(uri);
    }
}

#[must_use]
pub fn dev_vite_redirect_uri(host: &str) -> String {
    format!("http://{host}:{VITE_DEV_PORT}/auth/callback")
}

/// Add Vite dev callback URIs for each local IPv4 (tablet / LAN testing).
pub fn merge_lan_vite_redirect_uris(uris: &mut Vec<String>) {
    for ip in local_ipv4_addrs() {
        push_unique(uris, dev_vite_redirect_uri(&ip.to_string()));
    }
}

fn local_ipv4_addrs() -> Vec<Ipv4Addr> {
    let mut out = Vec::new();
    let Ok(sock) = UdpSocket::bind("0.0.0.0:0") else {
        return out;
    };
    for gateway in ["192.168.0.1:1", "10.0.0.1:1", "8.8.8.8:80"] {
        if sock.connect(gateway).is_ok() {
            if let Ok(addr) = sock.local_addr() {
                if let IpAddr::V4(v4) = addr.ip() {
                    if !v4.is_loopback() && !out.contains(&v4) {
                        out.push(v4);
                    }
                }
            }
        }
    }
    out
}

fn dev_vite_callback_allowed(uri: &str) -> bool {
    let uri = uri.trim();
    let Some(rest) = uri.strip_prefix("http://") else {
        return false;
    };
    let Some((authority, path)) = rest.split_once('/') else {
        return false;
    };
    if path != "auth/callback" {
        return false;
    }
    let Some((host, port)) = authority.rsplit_once(':') else {
        return false;
    };
    if port != VITE_DEV_PORT.to_string() {
        return false;
    }
    host == "localhost" || host.ends_with(".local") || host.parse::<IpAddr>().is_ok()
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
        apply_redirect_merges(&mut cfg);
        Ok(cfg)
    }

    /// CV transport actually used for this snapshot.
    ///
    /// dcc-bus needs a BigFred layout JWT. Standalone never has one, so
    /// `programmingMode: bigfred` would only yield `unauthorized`.
    #[must_use]
    pub fn cv_bus(&self) -> ProgrammingMode {
        if self.mode.is_standalone() {
            ProgrammingMode::Z21
        } else {
            self.programming_mode
        }
    }

    #[must_use]
    pub fn public(&self) -> PublicConfig {
        let programming_mode = self.cv_bus();
        PublicConfig {
            enabled: self.enabled,
            mode: self.mode,
            programming_mode,
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
            z21: if programming_mode.is_z21() {
                Some(Z21Public {
                    hostname: self.z21.hostname.trim().to_string(),
                    port: self.z21.port,
                })
            } else {
                None
            },
            wireless_programmer: WirelessProgrammerPublic {
                enabled: self.wireless_programmer.enabled,
                connected: false,
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
        if self.redirect_uris.iter().any(|u| u.trim() == uri) {
            return true;
        }
        self.dev_redirect_uris && dev_vite_callback_allowed(uri)
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
    pub programming_mode: ProgrammingMode,
    pub sso_client_id: String,
    pub redirect_uris: Vec<String>,
    pub idle_timeout_secs: u64,
    pub station_picker: bool,
    pub login_required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bigfred_public_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub z21: Option<Z21Public>,
    pub wireless_programmer: WirelessProgrammerPublic,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WirelessProgrammerPublic {
    pub enabled: bool,
    pub connected: bool,
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
        assert_eq!(cfg.programming_mode, ProgrammingMode::Bigfred);
        assert_eq!(cfg.bigfred.address, "bigfred.local:8080");
        assert_eq!(cfg.z21.hostname, "192.168.4.1");
        assert_eq!(cfg.z21.port, 21150);
        assert!(!cfg.enabled);
        assert!(cfg.wireless_programmer.enabled);
        assert_eq!(cfg.wireless_programmer.socket_connect_retry_interval, 60);
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
        assert_eq!(p.programming_mode, ProgrammingMode::Z21);
        assert_eq!(p.z21.as_ref().map(|z| z.port), Some(21150));
    }

    #[test]
    fn programming_mode_defaults_to_dcc_bus() {
        let raw = r#"{"mode":"standalone"}"#;
        let cfg: Config = serde_json::from_str(raw).unwrap();
        assert_eq!(cfg.mode, IntegrationMode::Standalone);
        assert_eq!(cfg.programming_mode, ProgrammingMode::Bigfred);
        assert_eq!(cfg.cv_bus(), ProgrammingMode::Z21);
        assert_eq!(cfg.public().z21.as_ref().map(|z| z.port), Some(21150));
    }

    #[test]
    fn wireless_programmer_parses_retry_interval() {
        let raw = r#"{"wirelessProgrammer":{"enabled":false,"socketConnectRetryInterval":30}}"#;
        let cfg: Config = serde_json::from_str(raw).unwrap();
        assert!(!cfg.wireless_programmer.enabled);
        assert_eq!(cfg.wireless_programmer.socket_connect_retry_interval, 30);
        let p = cfg.public();
        assert!(!p.wireless_programmer.enabled);
        assert!(!p.wireless_programmer.connected);
    }

    #[test]
    fn pom_write_repeat_defaults_on_and_is_toggleable() {
        assert!(Config::default().pom_write_repeat);
        let raw = r#"{"mode":"standalone","pomWriteRepeat":false}"#;
        let cfg: Config = serde_json::from_str(raw).unwrap();
        assert!(!cfg.pom_write_repeat);
    }

    #[test]
    fn standalone_never_uses_dcc_bus() {
        let cfg = Config {
            mode: IntegrationMode::Standalone,
            programming_mode: ProgrammingMode::Bigfred,
            ..Config::default()
        };
        assert_eq!(cfg.cv_bus(), ProgrammingMode::Z21);
        assert_eq!(cfg.public().programming_mode, ProgrammingMode::Z21);
    }

    #[test]
    fn programming_mode_json_round_trip() {
        let raw = r#"{"http":"0.0.0.0:8092","enabled":true,"mode":"bigfred","programmingMode":"z21","bigfred":{"address":"bigfred.local:8080"},"z21":{"hostname":"192.168.4.1","port":21150},"ssoClientId":"programming-center","redirectUris":[],"corsEnabled":false,"corsOrigins":[],"idleTimeoutSecs":86400,"devRedirectUris":false}"#;
        let cfg: Config = serde_json::from_str(raw).unwrap();
        assert_eq!(cfg.mode, IntegrationMode::Bigfred);
        assert_eq!(cfg.programming_mode, ProgrammingMode::Z21);
        assert_eq!(cfg.public().z21.as_ref().map(|z| z.port), Some(21150));
    }

    #[test]
    fn public_exposes_z21_when_programming_via_z21() {
        let cfg = Config {
            mode: IntegrationMode::Bigfred,
            programming_mode: ProgrammingMode::Z21,
            ..Config::default()
        };
        let p = cfg.public();
        assert!(p.station_picker);
        assert!(p.login_required);
        assert_eq!(p.programming_mode, ProgrammingMode::Z21);
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
        assert_eq!(p.programming_mode, ProgrammingMode::Bigfred);
        assert!(p.z21.is_none());
    }

    #[test]
    fn allows_vite_dev_callback_on_lan_ip() {
        let cfg = Config {
            dev_redirect_uris: true,
            ..Config::default()
        };
        assert!(cfg.redirect_uri_allowed("http://192.168.0.86:5176/auth/callback"));
        assert!(cfg.redirect_uri_allowed("http://localhost:5176/auth/callback"));
        assert!(!cfg.redirect_uri_allowed("http://192.168.0.86:8092/auth/callback"));
        assert!(!cfg.redirect_uri_allowed("http://evil.example:5176/auth/callback"));
        let prod = Config::default();
        assert!(!prod.redirect_uri_allowed("http://192.168.0.86:5176/auth/callback"));
    }

    #[test]
    fn merge_adds_lan_vite_redirects() {
        let mut uris = Vec::new();
        merge_vite_redirect_uris(&mut uris);
        assert!(uris.iter().any(|u| u.contains(":5176/auth/callback")));
        let mut prod = Vec::new();
        merge_builtin_redirect_uris(&mut prod);
        assert!(!prod.iter().any(|u| u.contains(":5176/auth/callback")));
    }
}
