//! NMRA CV identifiers and programming-track selection.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

/// Inclusive NMRA CV number range accepted on the wire (dcc-bus: 1–1024).
pub const CV_MIN: u16 = 1;
pub const CV_MAX: u16 = 1024;

/// CVs that encode the locomotive DCC address (short/long + CV29).
pub const ADDRESS_CVS: [u16; 4] = [1, 17, 18, 29];

/// One configuration variable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CvEntry {
    pub cv: u16,
    pub value: u8,
}

/// Track used for a CV operation. Distinct from JSON `mode` (bigfred vs standalone).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Track {
    /// Dedicated programming output.
    #[default]
    #[serde(rename = "prog")]
    Prog,
    /// Programming-on-main.
    #[serde(rename = "pom")]
    Pom,
}

impl Track {
    /// Wire value for dcc-bus JSON.
    #[must_use]
    pub fn as_wire(self) -> &'static str {
        match self {
            Self::Prog => "prog",
            Self::Pom => "pom",
        }
    }

    #[must_use]
    pub fn is_pom(self) -> bool {
        matches!(self, Self::Pom)
    }
}

/// Successful slots plus CV numbers that failed in a batch.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CvBatch {
    pub cvs: Vec<CvEntry>,
    pub errors: Vec<u16>,
}

impl CvBatch {
    pub fn merge(&mut self, other: Self) {
        self.cvs.extend(other.cvs);
        self.errors.extend(other.errors);
    }
}

/// Why [`expand_cv_list`] rejected the request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExpandError {
    Empty,
    InvalidRange,
    InvalidCv,
}

/// Union of an explicit CV list and an inclusive `from`–`to` range.
pub fn expand_cv_list(
    cvs: &[u16],
    from: Option<u16>,
    to: Option<u16>,
    skip_address: bool,
) -> Result<Vec<u16>, ExpandError> {
    match (from, to) {
        (None, None) => {
            if cvs.is_empty() {
                return Err(ExpandError::Empty);
            }
        }
        (Some(start), Some(end)) if start <= end => {}
        _ => return Err(ExpandError::InvalidRange),
    }
    for cv in cvs {
        if !valid_cv(*cv) {
            return Err(ExpandError::InvalidCv);
        }
    }
    if let (Some(start), Some(end)) = (from, to) {
        if !valid_cv(start) || !valid_cv(end) {
            return Err(ExpandError::InvalidCv);
        }
    }

    let mut set = BTreeSet::new();
    set.extend(cvs.iter().copied());
    if let (Some(start), Some(end)) = (from, to) {
        set.extend(start..=end);
    }
    if skip_address {
        for n in ADDRESS_CVS {
            set.remove(&n);
        }
    }
    if set.is_empty() {
        return Err(ExpandError::Empty);
    }
    Ok(set.into_iter().collect())
}

/// Returns true when `cv` is in the NMRA range accepted by BigFred dcc-bus.
#[must_use]
pub fn valid_cv(cv: u16) -> bool {
    (CV_MIN..=CV_MAX).contains(&cv)
}

/// Volume slider percent 0–100.
#[must_use]
pub fn valid_percent(percent: u8) -> bool {
    percent <= 100
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cv_bounds() {
        assert!(!valid_cv(0));
        assert!(valid_cv(1));
        assert!(valid_cv(1024));
        assert!(!valid_cv(1025));
    }

    #[test]
    fn track_wire() {
        assert_eq!(Track::Prog.as_wire(), "prog");
        assert_eq!(Track::Pom.as_wire(), "pom");
        assert!(Track::Pom.is_pom());
    }

    #[test]
    fn expand_list_only() {
        assert_eq!(
            expand_cv_list(&[3, 1, 3], None, None, false).unwrap(),
            vec![1, 3]
        );
    }

    #[test]
    fn expand_range_skip_address() {
        let got = expand_cv_list(&[], Some(1), Some(20), true).unwrap();
        assert!(!got.contains(&1));
        assert!(!got.contains(&17));
        assert_eq!(got.first().copied(), Some(2));
        assert_eq!(got.last().copied(), Some(20));
    }

    #[test]
    fn expand_union_and_empty() {
        assert_eq!(
            expand_cv_list(&[5], Some(1), Some(3), false).unwrap(),
            vec![1, 2, 3, 5]
        );
        assert_eq!(
            expand_cv_list(&[], None, None, false),
            Err(ExpandError::Empty)
        );
        assert_eq!(
            expand_cv_list(&[], Some(1), Some(1), true),
            Err(ExpandError::Empty)
        );
        assert_eq!(
            expand_cv_list(&[], Some(5), Some(2), false),
            Err(ExpandError::InvalidRange)
        );
        assert_eq!(
            expand_cv_list(&[0], None, None, false),
            Err(ExpandError::InvalidCv)
        );
    }
}
