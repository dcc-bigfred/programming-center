//! Connected-UDP Z21 client. Framing from `dcc-bigfred-proto-z21`.

use std::net::SocketAddr;
use std::time::Duration;

use dcc_bigfred_proto_z21 as z21;
use tokio::net::UdpSocket;
use tokio::sync::Mutex;
use tokio::time::{timeout, Instant};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);
const HELLO_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, thiserror::Error)]
pub enum CvError {
    #[error("udp: {0}")]
    Io(#[from] std::io::Error),
    #[error("timeout waiting for {0}")]
    Timeout(&'static str),
    #[error("decoder NACK")]
    Nack,
    #[error("decoder short circuit")]
    ShortCircuit,
}

pub struct Z21Client {
    peer: SocketAddr,
    sock: UdpSocket,
    codec: z21::Client,
    io: Mutex<()>,
    timeout: Duration,
}

impl Z21Client {
    pub async fn connect(addr: SocketAddr) -> Result<Self, CvError> {
        let sock = UdpSocket::bind("0.0.0.0:0").await?;
        let local = sock.local_addr().ok();
        sock.connect(addr).await?;
        tracing::info!(%addr, ?local, "z21 udp socket bound");
        let client = Self {
            peer: addr,
            sock,
            codec: z21::Client::new(),
            io: Mutex::new(()),
            timeout: DEFAULT_TIMEOUT,
        };
        match client.hello().await {
            Ok(serial) => {
                tracing::info!(%addr, ?local, serial, "z21 reachable");
                Ok(client)
            }
            Err(err) => {
                tracing::warn!(
                    %addr,
                    ?local,
                    error = %err,
                    "z21 did not answer LAN_GET_SERIAL_NUMBER (Roco/Z21 uses UDP 21105; RailBOX Soft-AP uses 21150)"
                );
                Err(err)
            }
        }
    }

    pub async fn read_cv(&self, cv: u16) -> Result<u8, CvError> {
        let _g = self.io.lock().await;
        self.await_result(&z21::Command::CvRead { cv }, cv).await
    }

    pub async fn write_cv(&self, cv: u16, value: u8) -> Result<u8, CvError> {
        let _g = self.io.lock().await;
        self.await_result(&z21::Command::CvWrite { cv, value }, cv)
            .await
    }

    pub async fn read_cv_pom(&self, addr: u16, cv: u16) -> Result<u8, CvError> {
        let _g = self.io.lock().await;
        self.await_result(&z21::Command::PomRead { addr, cv }, cv)
            .await
    }

    pub async fn write_cv_pom(&self, addr: u16, cv: u16, value: u8) -> Result<(), CvError> {
        let _g = self.io.lock().await;
        let pkt = self.encode(&z21::Command::PomWrite { addr, cv, value })?;
        tracing::debug!(peer = %self.peer, addr, cv, value, len = pkt.len(), "z21 pom write tx");
        self.sock.send(pkt.as_slice()).await?;
        Ok(())
    }

    fn encode(&self, cmd: &z21::Command) -> Result<z21::WireBuf, CvError> {
        let mut out = z21::WireBuf::new();
        self.codec.encode(cmd, &mut out).map_err(map_encode)?;
        Ok(out)
    }

    async fn hello(&self) -> Result<u32, CvError> {
        let mut codec = z21::Client::new();
        let mut pkt = z21::WireBuf::new();
        codec.on_connect(&mut pkt).map_err(map_encode)?;
        tracing::debug!(peer = %self.peer, len = pkt.len(), "z21 hello tx (serial + broadcast flags)");
        self.sock.send(pkt.as_slice()).await?;
        let deadline = Instant::now() + HELLO_TIMEOUT;
        let mut buf = [0u8; 1500];
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(CvError::Timeout("LAN_GET_SERIAL_NUMBER"));
            }
            let n = match timeout(remaining, self.sock.recv(&mut buf)).await {
                Ok(Ok(n)) => n,
                Ok(Err(err)) => {
                    tracing::warn!(peer = %self.peer, error = %err, "z21 hello recv failed");
                    return Err(err.into());
                }
                Err(_) => return Err(CvError::Timeout("LAN_GET_SERIAL_NUMBER")),
            };
            tracing::debug!(peer = %self.peer, n, preview = %hex_preview(&buf[..n]), "z21 hello rx");
            if let Some(serial) = parse_serial(&buf[..n]) {
                return Ok(serial);
            }
        }
    }

    async fn await_result(&self, cmd: &z21::Command, cv: u16) -> Result<u8, CvError> {
        let pkt = self.encode(cmd)?;
        tracing::debug!(
            peer = %self.peer,
            cv,
            cmd = %cmd_label(cmd),
            len = pkt.len(),
            "z21 cv tx"
        );
        self.sock.send(pkt.as_slice()).await?;
        let deadline = Instant::now() + self.timeout;
        let mut buf = [0u8; 1500];
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                tracing::warn!(peer = %self.peer, cv, cmd = %cmd_label(cmd), "z21 cv timeout");
                return Err(CvError::Timeout("CV reply"));
            }
            let n = match timeout(remaining, self.sock.recv(&mut buf)).await {
                Ok(Ok(n)) => n,
                Ok(Err(err)) => {
                    tracing::warn!(peer = %self.peer, cv, error = %err, "z21 cv recv failed");
                    return Err(err.into());
                }
                Err(_) => {
                    tracing::warn!(peer = %self.peer, cv, cmd = %cmd_label(cmd), "z21 cv timeout");
                    return Err(CvError::Timeout("CV reply"));
                }
            };
            tracing::debug!(
                peer = %self.peer,
                cv,
                n,
                preview = %hex_preview(&buf[..n]),
                "z21 cv rx"
            );
            match z21::parse_cv_reply(&buf[..n]) {
                Some(z21::Event::CvResult { cv: got, value }) if got == cv => {
                    tracing::debug!(peer = %self.peer, cv, value, "z21 cv result");
                    return Ok(value);
                }
                Some(z21::Event::CvResult { cv: got, value }) => {
                    tracing::debug!(peer = %self.peer, want = cv, got, value, "z21 cv result for other cv");
                    continue;
                }
                Some(z21::Event::CvNack) => {
                    tracing::info!(peer = %self.peer, cv, "z21 decoder NACK");
                    return Err(CvError::Nack);
                }
                Some(z21::Event::CvNackSc) => {
                    tracing::warn!(peer = %self.peer, cv, "z21 programming-track short circuit");
                    return Err(CvError::ShortCircuit);
                }
                Some(_) | None => continue,
            }
        }
    }
}

fn map_encode(err: z21::Error) -> CvError {
    CvError::Io(std::io::Error::other(match err {
        z21::Error::BufferFull => "z21 encode buffer full",
        z21::Error::InvalidAddress => "z21 invalid address",
    }))
}

fn parse_serial(buf: &[u8]) -> Option<u32> {
    let mut found = None;
    let mut codec = z21::Client::new();
    codec.on_bytes(buf, &mut |ev| {
        if let z21::Event::Serial(serial) = ev {
            found = Some(serial);
        }
    });
    found
}

fn cmd_label(cmd: &z21::Command) -> &'static str {
    match cmd {
        z21::Command::CvRead { .. } => "cv_read",
        z21::Command::CvWrite { .. } => "cv_write",
        z21::Command::PomRead { .. } => "pom_read",
        z21::Command::PomWrite { .. } => "pom_write",
        _ => "other",
    }
}

fn hex_preview(buf: &[u8]) -> String {
    const N: usize = 16;
    let n = buf.len().min(N);
    let mut out = String::with_capacity(n * 3);
    for (i, b) in buf[..n].iter().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        out.push_str(&format!("{b:02x}"));
    }
    if buf.len() > N {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_starts_with_get_serial() {
        let mut out = z21::WireBuf::new();
        z21::Client::new().on_connect(&mut out).unwrap();
        assert!(out.len() >= 4);
        assert_eq!(&out[..4], &[0x04, 0x00, 0x10, 0x00]);
    }
}
