//! Decoder programming domain for programming-center.
//!
//! Memory profile: **allocation-conscious**. This crate is the lean core of
//! CV bit-ops, volume mapping, and NMRA validation. It does no network I/O.

#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

pub mod bitop;
pub mod cv;
pub mod volume;

pub use bitop::apply as apply_bitop;
pub use cv::{
    expand_cv_list, valid_cv, valid_percent, CvBatch, CvEntry, ExpandError, Track, ADDRESS_CVS,
};
pub use volume::{
    DecoderId, LokSoundV4Volume, LokSoundV5Volume, Rb23xxVolume, VolumeRegistry, VolumeStrategy,
    ZimoMs450Volume,
};
