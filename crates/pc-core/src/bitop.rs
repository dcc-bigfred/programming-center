//! Read-modify-write bit operations on a single CV byte.
//!
//! `new = (old & and_mask) | or_mask`

/// Apply an AND/OR mask pair to a CV value.
#[must_use]
pub fn apply(old: u8, and_mask: u8, or_mask: u8) -> u8 {
    (old & and_mask) | or_mask
}

#[cfg(test)]
mod tests {
    use super::apply;

    #[test]
    fn set_bit_5_of_cv29() {
        // CV29 = 0x06 (28/128 steps + analog), set long-address bit 5.
        assert_eq!(apply(0x06, 0xFF, 0x20), 0x26);
    }

    #[test]
    fn clear_bit_5() {
        assert_eq!(apply(0x26, !0x20, 0), 0x06);
    }

    #[test]
    fn replace_low_nibble() {
        assert_eq!(apply(0xAB, 0xF0, 0x04), 0xA4);
    }
}
