//! Managed master-volume mapping. One [`VolumeStrategy`] per decoder id.
//!
//! Frontend sends 0–100 percent; this crate encodes manufacturer CVs.

use std::collections::HashMap;

use crate::cv::CvEntry;

/// Decoder identifier used on the wire (`decoder` field).
pub type DecoderId = &'static str;

/// Maps a 0–100 slider onto decoder-specific master-volume CVs.
pub trait VolumeStrategy: Send + Sync {
    fn decoder_id(&self) -> DecoderId;
    fn read_cvs(&self) -> &'static [u16];
    fn encode(&self, percent: u8) -> Vec<CvEntry>;
    fn decode(&self, cvs: &[CvEntry]) -> Option<u8>;
}

/// Closed registry: new decoder = new type + [`VolumeRegistry::insert`].
#[derive(Default)]
pub struct VolumeRegistry {
    inner: HashMap<DecoderId, Box<dyn VolumeStrategy>>,
}

impl VolumeRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn with_builtins() -> Self {
        let mut r = Self::new();
        r.insert(Box::new(ZimoMs450Volume));
        r.insert(Box::new(LokSoundV4Volume));
        r.insert(Box::new(LokSoundV5Volume));
        r.insert(Box::new(Rb23xxVolume));
        r
    }

    pub fn insert(&mut self, strategy: Box<dyn VolumeStrategy>) {
        self.inner.insert(strategy.decoder_id(), strategy);
    }

    #[must_use]
    pub fn get(&self, decoder_id: &str) -> Option<&dyn VolumeStrategy> {
        let id = match decoder_id {
            "rb2300" | "rb2302" => "rb23xx",
            other => other,
        };
        self.inner.get(id).map(|b| &**b)
    }
}

fn scale_up(percent: u8, max: u8) -> u8 {
    let p = u16::from(percent.min(100));
    let m = u16::from(max);
    ((p * m) / 100) as u8
}

fn scale_down(value: u8, max: u8) -> u8 {
    if max == 0 {
        return 0;
    }
    let v = u16::from(value.min(max));
    let m = u16::from(max);
    ((v * 100) / m) as u8
}

fn first_cv(cvs: &[CvEntry], num: u16) -> Option<u8> {
    cvs.iter().find(|e| e.cv == num).map(|e| e.value)
}

/// ZIMO MS450: CV 266, 100% = 65 (distortion-free for typical speakers).
pub struct ZimoMs450Volume;

impl VolumeStrategy for ZimoMs450Volume {
    fn decoder_id(&self) -> DecoderId {
        "zimo-ms450"
    }
    fn read_cvs(&self) -> &'static [u16] {
        &[266]
    }
    fn encode(&self, percent: u8) -> Vec<CvEntry> {
        vec![CvEntry {
            cv: 266,
            value: scale_up(percent, 65),
        }]
    }
    fn decode(&self, cvs: &[CvEntry]) -> Option<u8> {
        first_cv(cvs, 266).map(|v| scale_down(v, 65))
    }
}

/// ESU LokSound v4: CV 63, 0–64.
pub struct LokSoundV4Volume;

impl VolumeStrategy for LokSoundV4Volume {
    fn decoder_id(&self) -> DecoderId {
        "loksound-v4"
    }
    fn read_cvs(&self) -> &'static [u16] {
        &[63]
    }
    fn encode(&self, percent: u8) -> Vec<CvEntry> {
        vec![CvEntry {
            cv: 63,
            value: scale_up(percent, 64),
        }]
    }
    fn decode(&self, cvs: &[CvEntry]) -> Option<u8> {
        first_cv(cvs, 63).map(|v| scale_down(v, 64))
    }
}

/// ESU LokSound v5: CV 63, 0–192.
pub struct LokSoundV5Volume;

impl VolumeStrategy for LokSoundV5Volume {
    fn decoder_id(&self) -> DecoderId {
        "loksound-v5"
    }
    fn read_cvs(&self) -> &'static [u16] {
        &[63]
    }
    fn encode(&self, percent: u8) -> Vec<CvEntry> {
        vec![CvEntry {
            cv: 63,
            value: scale_up(percent, 192),
        }]
    }
    fn decode(&self, cvs: &[CvEntry]) -> Option<u8> {
        first_cv(cvs, 63).map(|v| scale_down(v, 192))
    }
}

/// RailBOX RB23xx (RB2300 / RB2302): CV 203, 100% = 64 (values above distort).
pub struct Rb23xxVolume;

impl VolumeStrategy for Rb23xxVolume {
    fn decoder_id(&self) -> DecoderId {
        "rb23xx"
    }
    fn read_cvs(&self) -> &'static [u16] {
        &[203]
    }
    fn encode(&self, percent: u8) -> Vec<CvEntry> {
        vec![CvEntry {
            cv: 203,
            value: scale_up(percent, 64),
        }]
    }
    fn decode(&self, cvs: &[CvEntry]) -> Option<u8> {
        first_cv(cvs, 203).map(|v| scale_down(v, 64))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtins_cover_all_decoders() {
        let r = VolumeRegistry::with_builtins();
        for id in [
            "zimo-ms450",
            "loksound-v4",
            "loksound-v5",
            "rb23xx",
            "rb2300",
            "rb2302",
        ] {
            assert!(r.get(id).is_some(), "{id}");
        }
        assert!(r.get("unknown").is_none());
    }

    #[test]
    fn zimo_roundtrip_ends() {
        let s = ZimoMs450Volume;
        assert_eq!(s.encode(0)[0].value, 0);
        assert_eq!(s.encode(100)[0].cv, 266);
        assert_eq!(s.encode(100)[0].value, 65);
        assert_eq!(s.decode(&s.encode(100)), Some(100));
        assert_eq!(s.decode(&s.encode(0)), Some(0));
    }

    #[test]
    fn loksound_v5_max_192() {
        let s = LokSoundV5Volume;
        assert_eq!(s.encode(100)[0].value, 192);
        assert_eq!(s.decode(&s.encode(50)).unwrap(), 50);
    }

    #[test]
    fn rb_caps_at_64() {
        let s = Rb23xxVolume;
        assert_eq!(s.encode(100)[0].cv, 203);
        assert_eq!(s.encode(100)[0].value, 64);
    }
}
