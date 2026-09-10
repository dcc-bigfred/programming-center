//! Connected-UDP Z21 client. Framing and record parsing from `dcc-bigfred-proto-z21`.

use std::net::SocketAddr;
use std::time::Duration;

use dcc_bigfred_proto_z21 as z21;
use tokio::net::UdpSocket;
use tokio::sync::{mpsc, Mutex};
use tokio::time::{timeout, Instant};
use tokio_util::sync::CancellationToken;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);
const HELLO_TIMEOUT: Duration = Duration::from_secs(3);
/// Driving + system state + all locos + RailCom for all locos (FW 1.29+).
const BROADCAST_FLAGS: u32 = 0x0005_0101;
/// LAN_RAILCOM_GETDATA poll while a telemetry subscribe is open.
const RAILCOM_POLL: Duration = Duration::from_millis(250);

/// LAN `0x88` fields we surface. Speed is DYN 0/1, QoS is DYN 7; Table 13 is not on this path.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Z21RailcomSnap {
    pub address: u16,
    pub speed_kmh: Option<u16>,
    pub qos_percent: Option<u8>,
}

/// Unsolicited programming-track / RailCom traffic while waiting to leave service mode.
///
/// `railcom` is bounded by [`z21::RAILCOM_ADDRS_MAX`] at ingest time; the bound
/// is structural (heapless `Vec`), so a flood of RailCom frames cannot grow it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Observed {
    pub prog_mode_ended: bool,
    pub railcom: heapless::Vec<u16, { z21::RAILCOM_ADDRS_MAX }>,
    pub central_state: Option<u8>,
    pub prog_current_ma: Option<i16>,
}

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
    #[error("cancelled")]
    Cancelled,
}

pub struct Z21Client {
    peer: SocketAddr,
    sock: UdpSocket,
    codec: z21::Client,
    /// Serializes the single Z21 programming slot: only one CV read/write may
    /// be in flight at a time. `observe()` deliberately does NOT hold this lock
    /// (it listens for unsolicited broadcasts while a previous write settles).
    slot: Mutex<()>,
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
            slot: Mutex::new(()),
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

    pub async fn read_cv(
        &self,
        cv: u16,
        cancel: Option<&CancellationToken>,
    ) -> Result<u8, CvError> {
        let _g = self.slot.lock().await;
        self.read_once_or_retry(&z21::Command::CvRead { cv }, cv, cancel)
            .await
    }

    pub async fn write_cv(
        &self,
        cv: u16,
        value: u8,
        cancel: Option<&CancellationToken>,
    ) -> Result<u8, CvError> {
        let _g = self.slot.lock().await;
        self.read_once_or_retry(&z21::Command::CvWrite { cv, value }, cv, cancel)
            .await
    }

    pub async fn read_cv_pom(
        &self,
        addr: u16,
        cv: u16,
        cancel: Option<&CancellationToken>,
    ) -> Result<u8, CvError> {
        let _g = self.slot.lock().await;
        self.read_once_or_retry(&z21::Command::PomRead { addr, cv }, cv, cancel)
            .await
    }

    /// POM writes are fire-and-forget — the Z21 broadcasts the DCC packet on
    /// the main track and the decoder may miss it. With `repeat` the packet
    /// goes out twice with a short gap, so a lost packet is not silent.
    pub async fn write_cv_pom(
        &self,
        addr: u16,
        cv: u16,
        value: u8,
        repeat: bool,
        cancel: Option<&CancellationToken>,
    ) -> Result<(), CvError> {
        const GAP: Duration = Duration::from_millis(50);
        let repeats: u8 = if repeat { 2 } else { 1 };
        let _g = self.slot.lock().await;
        let pkt = self.encode(&z21::Command::PomWrite { addr, cv, value })?;
        for attempt in 0..repeats {
            if cancel.is_some_and(CancellationToken::is_cancelled) {
                return Err(CvError::Cancelled);
            }
            tracing::debug!(
                peer = %self.peer, addr, cv, value, len = pkt.len(), attempt,
                pkt = %hex_preview(pkt.as_slice()),
                "z21 pom write tx"
            );
            self.sock.send(pkt.as_slice()).await?;
            if attempt + 1 < repeats {
                tokio::time::sleep(GAP).await;
            }
        }
        Ok(())
    }

    /// Listen until `LAN_X_BC_TRACK_POWER_ON` (`61 01`) or `until`, collecting RailCom.
    pub async fn observe(
        &self,
        until: Duration,
        cancel: Option<&CancellationToken>,
    ) -> Result<Observed, CvError> {
        if cancel.is_some_and(CancellationToken::is_cancelled) {
            return Err(CvError::Cancelled);
        }
        let deadline = Instant::now() + until;
        let mut observed = Observed::default();
        let mut buf = [0u8; 1500];
        loop {
            if cancel.is_some_and(CancellationToken::is_cancelled) {
                self.drain();
                return Err(CvError::Cancelled);
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                tracing::debug!(
                    peer = %self.peer,
                    ended = observed.prog_mode_ended,
                    railcom = ?observed.railcom,
                    "z21 observe deadline"
                );
                return Ok(observed);
            }
            let recv = timeout(remaining, self.sock.recv(&mut buf));
            let n = match cancel {
                Some(token) => tokio::select! {
                    () = token.cancelled() => {
                        self.drain();
                        return Err(CvError::Cancelled);
                    }
                    got = recv => match got {
                        Ok(Ok(n)) => n,
                        Ok(Err(err)) => return Err(err.into()),
                        Err(_) => return Ok(observed),
                    },
                },
                None => match recv.await {
                    Ok(Ok(n)) => n,
                    Ok(Err(err)) => return Err(err.into()),
                    Err(_) => return Ok(observed),
                },
            };
            tracing::debug!(
                peer = %self.peer,
                n,
                preview = %hex_preview(&buf[..n]),
                "z21 observe rx"
            );
            ingest(&buf[..n], &mut observed);
            if observed.prog_mode_ended {
                tracing::debug!(
                    peer = %self.peer,
                    railcom = ?observed.railcom,
                    central_state = ?observed.central_state,
                    prog_current_ma = ?observed.prog_current_ma,
                    "z21 programming mode ended"
                );
                return Ok(observed);
            }
        }
    }

    /// Poll `LAN_RAILCOM_GETDATA` and push matching snapshots until `cancel`.
    ///
    /// Holds the programming slot so CV I/O cannot race the same UDP socket.
    pub async fn watch_railcom(
        &self,
        addr: u16,
        cancel: &CancellationToken,
        tx: mpsc::Sender<Z21RailcomSnap>,
    ) -> Result<(), CvError> {
        let _g = tokio::select! {
            () = cancel.cancelled() => return Err(CvError::Cancelled),
            g = self.slot.lock() => g,
        };
        let mut codec = z21::Client::new();
        let mut buf = [0u8; 1500];
        loop {
            if cancel.is_cancelled() {
                self.drain();
                return Err(CvError::Cancelled);
            }
            let mut pkt = z21::WireBuf::new();
            z21::encode_railcom_get_data(&mut pkt, 0x01, addr).map_err(map_encode)?;
            self.sock.send(pkt.as_slice()).await?;
            let deadline = Instant::now() + RAILCOM_POLL;
            loop {
                if cancel.is_cancelled() {
                    self.drain();
                    return Err(CvError::Cancelled);
                }
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    break;
                }
                let recv = timeout(remaining, self.sock.recv(&mut buf));
                let n = tokio::select! {
                    () = cancel.cancelled() => {
                        self.drain();
                        return Err(CvError::Cancelled);
                    }
                    got = recv => match got {
                        Ok(Ok(n)) => n,
                        Ok(Err(err)) => return Err(err.into()),
                        Err(_) => break,
                    },
                };
                let snap = apply_railcom(&mut codec, &buf[..n]);
                tracing::debug!(
                    peer = %self.peer,
                    want = addr,
                    n,
                    dump = %hex_dump(&buf[..n]),
                    snap = ?snap,
                    "z21 railcom rx"
                );
                if let Some(snap) = snap {
                    if snap.address == addr && tx.send(snap).await.is_err() {
                        self.drain();
                        return Err(CvError::Cancelled);
                    }
                }
            }
        }
    }
    ///
    /// The single retry is a reliability policy for noisy Z21 LAN links. It is
    /// safe because `await_result` calls `drain()` on timeout, so a late reply
    /// to the first attempt is discarded before the second send. The retry
    /// does not apply to NACK / short-circuit (those are decoder verdicts).
    async fn read_once_or_retry(
        &self,
        cmd: &z21::Command,
        cv: u16,
        cancel: Option<&CancellationToken>,
    ) -> Result<u8, CvError> {
        match self.await_result(cmd, cv, cancel).await {
            Err(CvError::Timeout(_)) => self.await_result(cmd, cv, cancel).await,
            other => other,
        }
    }

    fn encode(&self, cmd: &z21::Command) -> Result<z21::WireBuf, CvError> {
        let mut out = z21::WireBuf::new();
        self.codec.encode(cmd, &mut out).map_err(map_encode)?;
        Ok(out)
    }

    /// Drop leftover datagrams so a late NACK is not counted as the next CV.
    fn drain(&self) {
        let mut sink = [0u8; 1500];
        while self.sock.try_recv(&mut sink).is_ok() {}
    }

    async fn hello(&self) -> Result<u32, CvError> {
        let mut codec = z21::Client::new();
        let mut pkt = z21::WireBuf::new();
        codec.on_connect(&mut pkt).map_err(map_encode)?;
        z21::encode_broadcast_flags(&mut pkt, BROADCAST_FLAGS).map_err(map_encode)?;
        tracing::debug!(
            peer = %self.peer,
            len = pkt.len(),
            flags = BROADCAST_FLAGS,
            "z21 hello tx (serial + broadcast flags)"
        );
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

    async fn await_result(
        &self,
        cmd: &z21::Command,
        cv: u16,
        cancel: Option<&CancellationToken>,
    ) -> Result<u8, CvError> {
        let pkt = self.encode(cmd)?;
        tracing::debug!(
            peer = %self.peer,
            cv,
            cmd = %cmd_label(cmd),
            len = pkt.len(),
            pkt = %hex_preview(pkt.as_slice()),
            "z21 cv tx"
        );
        self.sock.send(pkt.as_slice()).await?;
        let deadline = Instant::now() + self.timeout;
        let mut buf = [0u8; 1500];
        loop {
            if cancel.is_some_and(CancellationToken::is_cancelled) {
                self.drain();
                return Err(CvError::Cancelled);
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                tracing::warn!(peer = %self.peer, cv, cmd = %cmd_label(cmd), "z21 cv timeout");
                self.drain();
                return Err(CvError::Timeout("CV reply"));
            }
            let recv = timeout(remaining, self.sock.recv(&mut buf));
            let n = match cancel {
                Some(token) => tokio::select! {
                    () = token.cancelled() => {
                        self.drain();
                        return Err(CvError::Cancelled);
                    }
                    got = recv => match got {
                        Ok(Ok(n)) => n,
                        Ok(Err(err)) => {
                            tracing::warn!(peer = %self.peer, cv, error = %err, "z21 cv recv failed");
                            return Err(err.into());
                        }
                        Err(_) => {
                            tracing::warn!(peer = %self.peer, cv, cmd = %cmd_label(cmd), "z21 cv timeout");
                            self.drain();
                            return Err(CvError::Timeout("CV reply"));
                        }
                    },
                },
                None => match recv.await {
                    Ok(Ok(n)) => n,
                    Ok(Err(err)) => {
                        tracing::warn!(peer = %self.peer, cv, error = %err, "z21 cv recv failed");
                        return Err(err.into());
                    }
                    Err(_) => {
                        tracing::warn!(peer = %self.peer, cv, cmd = %cmd_label(cmd), "z21 cv timeout");
                        self.drain();
                        return Err(CvError::Timeout("CV reply"));
                    }
                },
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
    hex_bytes(buf, 16)
}

fn hex_dump(buf: &[u8]) -> String {
    hex_bytes(buf, 64)
}

fn hex_bytes(buf: &[u8], max: usize) -> String {
    let n = buf.len().min(max);
    let mut out = String::with_capacity(n * 3);
    for (i, b) in buf[..n].iter().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        out.push_str(&format!("{b:02x}"));
    }
    if buf.len() > max {
        out.push('…');
    }
    out
}

fn ingest(buf: &[u8], out: &mut Observed) {
    let mut codec = z21::Client::new();
    codec.on_bytes(buf, &mut |ev| ingest_event(ev, out));
}

fn apply_railcom(codec: &mut z21::Client, buf: &[u8]) -> Option<Z21RailcomSnap> {
    let mut snap = None;
    codec.on_bytes_with_railcom(buf, &mut |_| {}, &mut |d| {
        if let Some(address) = d.address {
            snap = Some(Z21RailcomSnap {
                address,
                speed_kmh: d.speed_kmh,
                qos_percent: d.qos_percent,
            });
        }
    });
    snap
}

fn ingest_event(ev: z21::Event, out: &mut Observed) {
    match ev {
        z21::Event::SystemState(state) => {
            out.prog_current_ma = Some(state.prog_current_ma);
            out.central_state = Some(state.central_state);
            if state.prog_mode_ended {
                out.prog_mode_ended = true;
            }
        }
        z21::Event::RailComLoco(addr) => {
            if !out.railcom.contains(&addr) && out.railcom.push(addr).is_ok() {
                tracing::debug!(addr, "z21 railcom loco");
            }
        }
        z21::Event::TrackPowerOn => {
            out.prog_mode_ended = true;
        }
        _ => {}
    }
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

    #[test]
    fn broadcast_flags_are_little_endian_00050101() {
        let mut out = z21::WireBuf::new();
        z21::encode_broadcast_flags(&mut out, BROADCAST_FLAGS).unwrap();
        assert_eq!(&out[2..4], &[0x50, 0x00]);
        assert_eq!(&out[4..8], &[0x01, 0x01, 0x05, 0x00]);
    }

    #[test]
    fn ingest_track_power_on_ends_programming() {
        let mut got = Observed::default();
        ingest(&[0x07, 0x00, 0x40, 0x00, 0x61, 0x01, 0x60], &mut got);
        assert!(got.prog_mode_ended);
    }

    #[test]
    fn ingest_programming_mode_does_not_end() {
        let mut got = Observed::default();
        ingest(&[0x07, 0x00, 0x40, 0x00, 0x61, 0x02, 0x63], &mut got);
        assert!(!got.prog_mode_ended);
    }

    #[test]
    fn ingest_railcom_loco_address() {
        let mut pkt = [0u8; 17];
        pkt[0] = 0x11;
        pkt[2] = 0x88;
        pkt[4..6].copy_from_slice(&13u16.to_be_bytes());
        let mut got = Observed::default();
        ingest(&pkt, &mut got);
        assert_eq!(got.railcom.as_slice(), &[13]);
    }

    #[test]
    fn ingest_systemstate_prog_current_and_central_state() {
        let mut pkt = [0u8; 20];
        pkt[0] = 0x14;
        pkt[2] = 0x84;
        pkt[6] = 42;
        pkt[7] = 0;
        pkt[16] = 0x00;
        let mut got = Observed::default();
        ingest(&pkt, &mut got);
        assert_eq!(got.prog_current_ma, Some(42));
        assert_eq!(got.central_state, Some(0));
        assert!(got.prog_mode_ended);
    }

    #[test]
    fn ingest_concatenated_records() {
        let mut railcom = [0u8; 17];
        railcom[0] = 0x11;
        railcom[2] = 0x88;
        railcom[4..6].copy_from_slice(&13u16.to_be_bytes());
        let mut sys = [0u8; 20];
        sys[0] = 0x14;
        sys[2] = 0x84;
        sys[6] = 7;
        sys[16] = z21::CS_PROGRAMMING_MODE;
        let power_on = [0x07, 0x00, 0x40, 0x00, 0x61, 0x01, 0x60];
        let mut buf = Vec::new();
        buf.extend_from_slice(&railcom);
        buf.extend_from_slice(&sys);
        buf.extend_from_slice(&power_on);
        let mut got = Observed::default();
        ingest(&buf, &mut got);
        assert_eq!(got.railcom.as_slice(), &[13]);
        assert_eq!(got.prog_current_ma, Some(7));
        assert_eq!(got.central_state, Some(z21::CS_PROGRAMMING_MODE));
        assert!(got.prog_mode_ended);
    }

    #[test]
    fn ingest_railcom_caps_unique_addresses() {
        let mut got = Observed::default();
        for i in 1u16..=12 {
            let mut pkt = [0u8; 17];
            pkt[0] = 0x11;
            pkt[2] = 0x88;
            pkt[4..6].copy_from_slice(&i.to_be_bytes());
            ingest(&pkt, &mut got);
        }
        assert_eq!(got.railcom.len(), z21::RAILCOM_ADDRS_MAX);
        assert_eq!(got.railcom.as_slice(), &[1, 2, 3, 4, 5, 6, 7, 8]);
    }

    #[test]
    fn apply_railcom_address_is_high_byte_first() {
        let mut codec = z21::Client::new();
        let mut pkt = [0u8; 17];
        pkt[0] = 0x11;
        pkt[2] = 0x88;
        pkt[4] = 0x26;
        pkt[5] = 0x02;
        let snap = apply_railcom(&mut codec, &pkt).expect("snapshot");
        assert_eq!(snap.address, 9730);
    }

    fn lan_railcom_frame(addr: u16, options: u8, speed: u8, qos: u8) -> [u8; 17] {
        let mut pkt = [0u8; 17];
        pkt[0] = 0x11;
        pkt[2] = 0x88;
        pkt[4..6].copy_from_slice(&addr.to_be_bytes());
        pkt[13] = options;
        pkt[14] = speed;
        pkt[15] = qos;
        pkt
    }

    #[test]
    fn apply_railcom_maps_speed_and_qos() {
        let mut codec = z21::Client::new();
        let snap = apply_railcom(
            &mut codec,
            &lan_railcom_frame(13, z21::RCO_SPEED1 | z21::RCO_QOS, 80, 12),
        )
        .expect("snapshot");
        assert_eq!(snap.address, 13);
        assert_eq!(snap.speed_kmh, Some(80));
        assert_eq!(snap.qos_percent, Some(12));
    }

    #[test]
    fn apply_railcom_is_per_loco() {
        let mut codec = z21::Client::new();
        let first = apply_railcom(&mut codec, &lan_railcom_frame(13, z21::RCO_SPEED1, 80, 0))
            .expect("loco 13");
        assert_eq!(first.address, 13);
        assert_eq!(first.speed_kmh, Some(80));
        assert_eq!(first.qos_percent, None);
        let second =
            apply_railcom(&mut codec, &lan_railcom_frame(7, z21::RCO_QOS, 0, 12)).expect("loco 7");
        assert_eq!(second.address, 7);
        assert_eq!(second.speed_kmh, None);
        assert_eq!(second.qos_percent, Some(12));
        let again = apply_railcom(&mut codec, &lan_railcom_frame(13, z21::RCO_QOS, 0, 3))
            .expect("loco 13 qos");
        assert_eq!(again.address, 13);
        assert_eq!(again.speed_kmh, Some(80));
        assert_eq!(again.qos_percent, Some(3));
    }
}
