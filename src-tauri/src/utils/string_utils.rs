/// Safely truncates a string to at most `max_bytes` bytes, ensuring the cut
/// happens at a valid UTF-8 character boundary (not in the middle of a multi-byte character).
///
/// This prevents panics when truncating strings containing multi-byte characters
/// like Korean, Chinese, Japanese, or emoji.
///
/// # Example
/// ```
/// let korean = "안녕하세요"; // Korean greeting
/// let truncated = safe_truncate(korean, 5);
/// // Returns "안" (3 bytes) instead of panicking at byte 5
/// ```
/// fix for https://github.com/NoRiskClient/issues/issues/2476
pub fn safe_truncate(s: &str, max_bytes: usize) -> &str {
    if max_bytes >= s.len() {
        return s;
    }
    // Find the last valid character boundary at or before max_bytes
    let mut end = max_bytes;
    while !s.is_char_boundary(end) && end > 0 {
        end -= 1;
    }
    &s[..end]
}
