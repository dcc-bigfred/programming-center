//! Decoder programming domain for programming-center.
//!
//! Memory profile: **allocation-conscious**. This crate is the lean core of
//! CV bit-ops and NMRA validation. It does no network I/O.

#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

pub mod address;
pub mod bitop;
pub mod cv;

pub use address::{
    apply_long_bit, apply_railcom_plus, decode_address, encode_long_bytes, is_long,
    plan_address_writes, plan_set_writes, railcom_plus_on, AddressError, PlanSetWrites,
    CV29_LONG_BIT, LONG_MAX, RAILCOM_PLUS_BIT, RAILCOM_PLUS_CV, RAILCOM_PLUS_MASK, SETTLE,
    SHORT_MAX,
};
pub use bitop::apply as apply_bitop;
pub use cv::{expand_cv_list, valid_cv, CvBatch, CvEntry, ExpandError, Track, ADDRESS_CVS};
