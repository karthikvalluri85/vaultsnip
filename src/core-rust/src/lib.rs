//! VaultSnip core scanner.
//!
//! Faithful port of `classify()` in `web/app.js`. A piece of text is either safe (`NONE`) or gets
//! one reason to be masked. The checks run in the same order as the JavaScript, because the order
//! decides which label a token gets (an email-like ID is "Email", not "Identifier").
//!
//! Bridge design (what we kept from reading `censgate/redact`'s `redact-wasm`, and what we changed):
//! * redact passes `&str` in and returns a JSON `String` out: two copies plus serde on every call.
//! * Here `scan` takes ONE joined string for a whole batch (one boundary crossing, not one per
//!   text node) and returns a `Vec<u8>` of category codes, one byte per text. No JSON.
//! * Policy (allowlist, client names) is pushed in once and kept inside the module.
//!
//! The module imports nothing from the host except wasm-bindgen's own glue. It has no network,
//! storage, clock or randomness.

use std::collections::HashSet;
use wasm_bindgen::prelude::*;

pub const NONE: u8 = 0;
pub const CLIENT_NAME: u8 = 1;
pub const EMAIL: u8 = 2;
pub const IDENTIFIER: u8 = 3;
pub const NUMBER_OR_MONEY: u8 = 4;
pub const NOT_ON_ALLOWLIST: u8 = 5;

/// Separator between texts in a `scan` batch (ASCII unit separator). The TS bridge strips it from input.
const SEP: char = '\u{1f}';

/// JS `\s` and `String.prototype.trim`: Rust's White_Space plus U+FEFF, minus U+0085 (NEL),
/// which JS does not count as whitespace.
fn is_js_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

// JS `\w` without the `u` flag is ASCII only, so these are ASCII only too.
fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}
fn is_currency(c: char) -> bool {
    matches!(c, '€' | '$' | '£' | '¥' | '₹' | '%')
}

/// `raw.replace(/^[^\w€$£¥₹%#@]+|[^\w€$£¥₹%]+$/g, '')`
fn clean(raw: &str) -> &str {
    raw.trim_start_matches(|c: char| !(is_word(c) || is_currency(c) || c == '#' || c == '@'))
        .trim_end_matches(|c: char| !(is_word(c) || is_currency(c)))
}

/// `/\w@\w/.test(raw) || (/@/.test(raw) && /\./.test(raw))`
fn is_email(raw: &str) -> bool {
    let b = raw.as_bytes();
    let word = |x: u8| x.is_ascii_alphanumeric() || x == b'_';
    let has_at_pair = (1..b.len().saturating_sub(1)).any(|i| b[i] == b'@' && word(b[i - 1]) && word(b[i + 1]));
    has_at_pair || (raw.contains('@') && raw.contains('.'))
}

/// `/^(19|20)\d{2}$/` or `/^(q[1-4]|h[12]|fy\d{2,4}|w\d{1,2}|p\d{1,2})$/i`, tested on lower-cased text.
fn is_period(low: &str) -> bool {
    let b = low.as_bytes();
    let digits = |s: &[u8]| s.iter().all(|c| c.is_ascii_digit());
    if b.len() == 4 && (b.starts_with(b"19") || b.starts_with(b"20")) && digits(&b[2..]) {
        return true;
    }
    match b.first() {
        Some(b'q') => b.len() == 2 && (b'1'..=b'4').contains(&b[1]),
        Some(b'h') => b.len() == 2 && (b[1] == b'1' || b[1] == b'2'),
        Some(b'f') if b.starts_with(b"fy") => (2..=4).contains(&(b.len() - 2)) && digits(&b[2..]),
        Some(b'w') | Some(b'p') => (1..=2).contains(&(b.len() - 1)) && digits(&b[1..]),
        _ => false,
    }
}

/// `/[A-Za-z]{2,}[-_]?\d{3,}|\d{3,}[-_][A-Za-z]/` (unanchored).
fn is_identifier(s: &str) -> bool {
    let b = s.as_bytes();
    let n = b.len();
    let run = |from: usize, f: fn(&u8) -> bool| b[from..].iter().take_while(|c| f(c)).count();
    let mut i = 0;
    while i < n {
        if b[i].is_ascii_alphabetic() {
            // a maximal letter run is the only place the letters-then-digits form can start
            let len = run(i, u8::is_ascii_alphabetic);
            let mut j = i + len;
            if len >= 2 {
                if j < n && (b[j] == b'-' || b[j] == b'_') {
                    j += 1;
                }
                if j < n && run(j, u8::is_ascii_digit) >= 3 {
                    return true;
                }
            }
            i += len;
        } else if b[i].is_ascii_digit() {
            let len = run(i, u8::is_ascii_digit);
            let j = i + len;
            if len >= 3 && j + 1 < n && (b[j] == b'-' || b[j] == b'_') && b[j + 1].is_ascii_alphabetic() {
                return true;
            }
            i += len;
        } else {
            i += 1;
        }
    }
    false
}

/// `/[\d€$£¥₹%]/.test(s)`
fn has_number_or_money(s: &str) -> bool {
    s.chars().any(|c| c.is_ascii_digit() || is_currency(c))
}

/// One entry per line. An entry may contain spaces ("acme widgets" allows only that exact text,
/// as `extraAllow()` does in JS); splitting on spaces would also allow "acme" alone.
fn entry_set(list: &str) -> HashSet<String> {
    list.split('\n')
        .map(|w| w.trim_matches(is_js_space).to_lowercase())
        .filter(|w| !w.is_empty())
        .collect()
}

#[wasm_bindgen]
#[derive(Default)]
pub struct Scanner {
    /// ALLOW plus the user's extra allowlist (lower-case).
    allow: HashSet<String>,
    /// Words the user approved during this session. Counts for a whole token but not for the
    /// parts of a hyphenated one, exactly like the JavaScript.
    session: HashSet<String>,
    clients: Vec<String>,
}

#[wasm_bindgen]
impl Scanner {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Scanner {
        Scanner::default()
    }

    /// One entry per line.
    pub fn set_allowlist(&mut self, words: &str) {
        self.allow = entry_set(words);
    }

    /// One entry per line.
    pub fn set_session_allow(&mut self, words: &str) {
        self.session = entry_set(words);
    }

    /// Comma-separated; a name may contain spaces ("acme corp").
    pub fn set_client_names(&mut self, names: &str) {
        self.clients = names
            .split(',')
            .map(|n| n.trim_matches(is_js_space).to_lowercase())
            .filter(|n| !n.is_empty())
            .collect();
    }

    /// Category code for one text (`NONE` = safe to keep).
    pub fn classify(&self, text: &str) -> u8 {
        let raw = text.trim_matches(is_js_space);
        let clean = clean(raw);
        if clean.is_empty() {
            return NONE;
        }
        let low = clean.to_lowercase();
        if self
            .clients
            .iter()
            .any(|n| low.contains(n.as_str()) || n.split(is_js_space).any(|p| p == low))
        {
            return CLIENT_NAME;
        }
        if is_email(raw) {
            return EMAIL;
        }
        if is_period(&low) {
            return NONE;
        }
        if is_identifier(clean) {
            return IDENTIFIER;
        }
        if has_number_or_money(clean) {
            return NUMBER_OR_MONEY;
        }
        if clean.encode_utf16().count() <= 1 {
            return NONE;
        }
        if self.allow.contains(&low) || self.session.contains(&low) {
            return NONE;
        }
        let parts: Vec<&str> = low.split(|c: char| c == '-' || c == '/' || c == '&').filter(|p| !p.is_empty()).collect();
        if parts.len() > 1 && parts.iter().all(|p| self.allow.contains(*p)) {
            return NONE;
        }
        NOT_ON_ALLOWLIST
    }

    /// Classify a whole batch in one call. `joined` is the texts separated by U+001F; the result
    /// has one code per text, in order.
    pub fn scan(&self, joined: &str) -> Vec<u8> {
        joined.split(SEP).map(|t| self.classify(t)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scanner() -> Scanner {
        let mut s = Scanner::new();
        s.set_allowlist("revenue\nsales\nregion\nnorth\nsouth\nq\njan\nfeb\ntotal\nacme widgets");
        s.set_session_allow("widgets");
        s.set_client_names("Acme Corp, Globex");
        s
    }

    #[test]
    fn email_wins_over_identifier() {
        assert_eq!(scanner().classify("ab123456@x.com"), EMAIL);
        assert_eq!(scanner().classify("name@host"), EMAIL);
        assert_eq!(scanner().classify("see a@ b."), EMAIL); // has @ and .
    }

    #[test]
    fn client_names_beat_everything() {
        let s = scanner();
        assert_eq!(s.classify("Acme Corp"), CLIENT_NAME);
        assert_eq!(s.classify("Globex Q3"), CLIENT_NAME);
        assert_eq!(s.classify("acme"), CLIENT_NAME); // a word of a listed name
    }

    #[test]
    fn periods_are_kept() {
        let s = scanner();
        for t in ["2024", "1999", "Q3", "h2", "FY24", "FY2024", "W7", "p12"] {
            assert_eq!(s.classify(t), NONE, "{t}");
        }
        assert_eq!(s.classify("2100"), NUMBER_OR_MONEY);
        assert_eq!(s.classify("Q5"), NUMBER_OR_MONEY); // not a real quarter, still has a digit
        assert_eq!(s.classify("FY2"), NUMBER_OR_MONEY);
    }

    #[test]
    fn identifiers() {
        let s = scanner();
        assert_eq!(s.classify("INV-20931"), IDENTIFIER);
        assert_eq!(s.classify("ab123"), IDENTIFIER);
        assert_eq!(s.classify("4410-X"), IDENTIFIER);
        assert_eq!(s.classify("A-123"), NUMBER_OR_MONEY); // one letter is not enough
        assert_eq!(s.classify("ab-12"), NUMBER_OR_MONEY);
    }

    #[test]
    fn numbers_and_money() {
        let s = scanner();
        assert_eq!(s.classify("$1.2M"), NUMBER_OR_MONEY);
        assert_eq!(s.classify("45%"), NUMBER_OR_MONEY);
        assert_eq!(s.classify("(1,204)"), NUMBER_OR_MONEY);
    }

    #[test]
    fn allowlist_default_deny() {
        let s = scanner();
        assert_eq!(s.classify("Revenue"), NONE);
        assert_eq!(s.classify("widgets"), NONE); // session
        assert_eq!(s.classify("North-South"), NONE);
        assert_eq!(s.classify("widgets-revenue"), NOT_ON_ALLOWLIST); // session words don't count inside a compound
        assert_eq!(s.classify("Initech"), NOT_ON_ALLOWLIST);
        assert_eq!(s.classify("x"), NONE);
        assert_eq!(s.classify("  ...  "), NONE);
    }

    #[test]
    fn allowlist_entry_with_space_is_one_entry() {
        let mut s = Scanner::new();
        s.set_allowlist("acme widgets");
        assert_eq!(s.classify("Acme Widgets"), NONE);
        assert_eq!(s.classify("acme"), NOT_ON_ALLOWLIST);
        assert_eq!(s.classify("widgets"), NOT_ON_ALLOWLIST);
    }

    #[test]
    fn whitespace_follows_js() {
        let s = scanner();
        assert_eq!(s.classify("\u{feff}Revenue\u{feff}"), NONE); // JS trim strips U+FEFF
        assert_eq!(s.classify("\u{a0}Revenue\u{3000}"), NONE);
        // JS trim keeps U+0085, but clean() then strips it as a non-word edge character
        assert_eq!(s.classify("\u{85}Revenue"), NONE);
    }

    #[test]
    fn batch_scan_matches_single() {
        let s = scanner();
        let out = s.scan("Revenue\u{1f}Initech\u{1f}$5\u{1f}");
        assert_eq!(out, vec![NONE, NOT_ON_ALLOWLIST, NUMBER_OR_MONEY, NONE]);
    }
}
