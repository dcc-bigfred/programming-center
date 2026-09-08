//! Decoder programming domain for programming-center.
//!
//! Memory profile: **allocation-conscious**. This crate is the lean core of
//! CV bit-ops and NMRA validation. It does no network I/O.

#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

pub mod bitop;
pub mod cv;

pub use bitop::apply as apply_bitop;
pub use cv::{expand_cv_list, valid_cv, CvBatch, CvEntry, ExpandError, Track, ADDRESS_CVS};
