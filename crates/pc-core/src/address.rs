//! NMRA / ESU DCC locomotive address (CV 1 or CV 17/18 + CV 29).
//!
//! Atoms live in `dcc-bigfred-proto-z21`. This module composes them into
//! [`CvEntry`] writes for programming-center.

use dcc_bigfred_proto_z21 as z21;

use crate::cv::CvEntry;

pub use z21::{
    apply_long_bit, apply_railcom_plus, decode_address, encode_long_bytes, is_long,
    railcom_plus_on, AddressError, CV29_LONG_BIT, LONG_MAX, RAILCOM_PLUS_BIT, RAILCOM_PLUS_CV,
    RAILCOM_PLUS_MASK, SHORT_MAX,
};

/// Settle time between service-mode slots (Z21 needs ~300 ms between writes).
pub const SETTLE: std::time::Duration = std::time::Duration::from_millis(300);

/// Outcome of planning an `address.set` write batch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlanSetWrites {
    /// The writes are ready to send.
    Ok(Vec<CvEntry>),
    /// `railcom_plus` was requested but CV 28 was not read; CV 28 is skipped.
    /// The address writes still proceed.
    SkippedRailcomPlus { want: bool, writes: Vec<CvEntry> },
}

/// Plan the full ESU service-mode write batch: optional CV 28 bit 7
/// (RailComPlus), then the address writes (CV 17→18→29 or CV 1→29).
///
/// `cv28` is the value read before the write; `None` means "not read". When
/// `railcom_plus` is requested but `cv28` is `None`, the RailComPlus write is
/// skipped and the outcome is [`PlanSetWrites::SkippedRailcomPlus`] so the
/// caller can log/warn without re-deriving the decision.
pub fn plan_set_writes(
    new_address: u16,
    cv29: u8,
    long_bit: u8,
    cv28: Option<u8>,
    railcom_plus: Option<bool>,
) -> Result<PlanSetWrites, AddressError> {
    let mut writes = Vec::new();
    let mut skipped = None;
    if let Some(want) = railcom_plus {
        match cv28 {
            Some(cur) => {
                let next = apply_railcom_plus(cur, want);
                if next != cur {
                    writes.push(CvEntry {
                        cv: RAILCOM_PLUS_CV,
                        value: next,
                    });
                }
            }
            None => skipped = Some(want),
        }
    }
    writes.extend(plan_address_writes(new_address, cv29, long_bit)?);
    Ok(match skipped {
        Some(want) => PlanSetWrites::SkippedRailcomPlus { want, writes },
        None => PlanSetWrites::Ok(writes),
    })
}

/// Ordered service-mode writes for `address` given the current CV 29 value.
///
/// 1–127 → CV 1, then CV 29 with the long bit clear.
/// 128–10239 → CV 17, CV 18, then CV 29 with the long bit set.
pub fn plan_address_writes(
    address: u16,
    cv29: u8,
    long_bit: u8,
) -> Result<Vec<CvEntry>, AddressError> {
    let writes = z21::address_cv_writes_bit(address, cv29, long_bit)?;
    Ok(writes
        .into_iter()
        .map(|(cv, value)| CvEntry { cv, value })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_out_of_range() {
        assert_eq!(
            plan_address_writes(0, 30, CV29_LONG_BIT),
            Err(AddressError::InvalidAddress)
        );
        assert_eq!(
            plan_address_writes(LONG_MAX + 1, 30, CV29_LONG_BIT),
            Err(AddressError::InvalidAddress)
        );
        assert_eq!(
            apply_long_bit(30, true, 8),
            Err(AddressError::InvalidLongBit)
        );
    }

    #[test]
    fn short_clears_bit_after_cv1() {
        let got = plan_address_writes(13, 62, CV29_LONG_BIT).unwrap();
        assert_eq!(
            got,
            vec![CvEntry { cv: 1, value: 13 }, CvEntry { cv: 29, value: 30 },]
        );
    }

    #[test]
    fn long_9728_is_cv17_then_18_then_bit5() {
        let got = plan_address_writes(9728, 30, CV29_LONG_BIT).unwrap();
        assert_eq!(encode_long_bytes(9728), (230, 0));
        assert_eq!(
            got,
            vec![
                CvEntry { cv: 17, value: 230 },
                CvEntry { cv: 18, value: 0 },
                CvEntry { cv: 29, value: 62 },
            ]
        );
    }

    #[test]
    fn railbox_long_bit_3() {
        let got = plan_address_writes(128, 0, 3).unwrap();
        assert_eq!(
            got[2],
            CvEntry {
                cv: 29,
                value: 1 << 3
            }
        );
    }

    #[test]
    fn apply_railcom_plus_toggles_bit_7() {
        assert_eq!(apply_railcom_plus(131, false), 3);
        assert_eq!(apply_railcom_plus(3, true), 131);
        assert!(railcom_plus_on(131));
        assert!(!railcom_plus_on(3));
    }

    #[test]
    fn decode_short_13_and_long_2138_9728() {
        assert_eq!(decode_address(13, 200, 89, 30, CV29_LONG_BIT), (13, false));
        assert_eq!(decode_address(13, 200, 90, 62, CV29_LONG_BIT), (2138, true));
        assert_eq!(decode_address(13, 230, 0, 62, CV29_LONG_BIT), (9728, true));
    }

    #[test]
    fn plan_set_writes_long_with_railcom_plus_off() {
        let got = plan_set_writes(2138, 30, CV29_LONG_BIT, Some(131), Some(false)).unwrap();
        let PlanSetWrites::Ok(writes) = got else {
            panic!("expected Ok, got {got:?}");
        };
        let cvs: Vec<u16> = writes.iter().map(|e| e.cv).collect();
        assert_eq!(cvs, vec![RAILCOM_PLUS_CV, 17, 18, 29]);
    }

    #[test]
    fn plan_set_writes_skips_cv28_when_already_matching() {
        let got = plan_set_writes(2138, 30, CV29_LONG_BIT, Some(3), Some(false)).unwrap();
        let PlanSetWrites::Ok(writes) = got else {
            panic!("expected Ok, got {got:?}");
        };
        let cvs: Vec<u16> = writes.iter().map(|e| e.cv).collect();
        assert_eq!(cvs, vec![17, 18, 29]);
    }

    #[test]
    fn plan_set_writes_reports_skip_when_cv28_missing() {
        let got = plan_set_writes(13, 62, CV29_LONG_BIT, None, Some(false)).unwrap();
        let PlanSetWrites::SkippedRailcomPlus { want, writes } = got else {
            panic!("expected SkippedRailcomPlus, got {got:?}");
        };
        assert!(!want);
        let cvs: Vec<u16> = writes.iter().map(|e| e.cv).collect();
        assert_eq!(cvs, vec![1, 29]);
    }

    #[test]
    fn plan_set_writes_without_railcom_plus_is_plain_ok() {
        let got = plan_set_writes(9728, 30, CV29_LONG_BIT, Some(131), None).unwrap();
        let PlanSetWrites::Ok(writes) = got else {
            panic!("expected Ok, got {got:?}");
        };
        assert_eq!(writes.len(), 3);
    }

    #[test]
    fn settle_is_300ms() {
        assert_eq!(SETTLE, std::time::Duration::from_millis(300));
    }
}
