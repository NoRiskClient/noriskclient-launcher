use super::*;

const MC: char = ':';

#[test]
fn parses_and_renders_round_trip() {
    let text = "fov:0.5\nlang:de_de\nsoundCategory_master:1.0\n";
    let doc = OptionsDocument::parse(text, MC);
    assert_eq!(doc.render(), text);
}

#[test]
fn keeps_unparsable_lines_in_place() {
    let text = "fov:0.5\nthis line has no separator\nlang:de_de\n";
    let mut doc = OptionsDocument::parse(text, MC);
    doc.set("fov", "0.9");
    assert_eq!(
        doc.render(),
        "fov:0.9\nthis line has no separator\nlang:de_de\n"
    );
}

#[test]
fn values_may_contain_the_separator() {
    let doc = OptionsDocument::parse("key:a:b:c\n", MC);
    assert_eq!(doc.get("key"), Some("a:b:c"));
    assert_eq!(doc.render(), "key:a:b:c\n");
}

#[test]
fn json_style_values_survive() {
    let text = "resourcePacks:[\"vanilla\",\"file/foo.zip\"]\n";
    let doc = OptionsDocument::parse(text, MC);
    assert_eq!(doc.get("resourcePacks"), Some("[\"vanilla\",\"file/foo.zip\"]"));
    assert_eq!(doc.render(), text);
}

#[test]
fn set_appends_unknown_keys_at_the_end() {
    let mut doc = OptionsDocument::parse("fov:0.5\n", MC);
    doc.set("lang", "en_us");
    assert_eq!(doc.render(), "fov:0.5\nlang:en_us\n");
}

#[test]
fn apply_overrides_known_keys_and_reports_change() {
    let mut target = OptionsDocument::parse("fov:0.5\nlang:de_de\n", MC);
    let source = OptionsDocument::parse("fov:0.9\nguiScale:3\n", MC);
    assert!(target.apply(&source, &[]));
    assert_eq!(target.get("fov"), Some("0.9"));
    assert_eq!(target.get("guiScale"), Some("3"));
    assert_eq!(target.get("lang"), Some("de_de"));
}

#[test]
fn apply_skips_local_keys() {
    let mut target = OptionsDocument::parse("resourcePacks:[\"mine\"]\nfov:0.5\n", MC);
    let source = OptionsDocument::parse("resourcePacks:[\"theirs\"]\nfov:0.9\n", MC);
    let skip = vec!["resourcePacks".to_string()];
    assert!(target.apply(&source, &skip));
    assert_eq!(target.get("resourcePacks"), Some("[\"mine\"]"));
    assert_eq!(target.get("fov"), Some("0.9"));
}

#[test]
fn apply_without_differences_reports_no_change() {
    let mut target = OptionsDocument::parse("fov:0.5\n", MC);
    let source = OptionsDocument::parse("fov:0.5\n", MC);
    assert!(!target.apply(&source, &[]));
}

#[test]
fn crlf_input_is_normalized_to_lf() {
    let doc = OptionsDocument::parse("fov:0.5\r\nlang:de_de\r\n", MC);
    assert_eq!(doc.render(), "fov:0.5\nlang:de_de\n");
}

#[test]
fn plain_key_value_format_uses_equals() {
    let sep = separator_for(MergeFormat::PlainKeyValue);
    let doc = OptionsDocument::parse("a=1\nb=2\n", sep);
    assert_eq!(doc.get("a"), Some("1"));
    assert_eq!(doc.render(), "a=1\nb=2\n");
}

#[test]
fn comments_and_blank_lines_stay_raw() {
    let text = "# a comment\n\nfov:0.5\n";
    let mut doc = OptionsDocument::parse(text, MC);
    doc.set("fov", "0.7");
    assert_eq!(doc.render(), "# a comment\n\nfov:0.7\n");
}

#[test]
fn empty_input_renders_empty() {
    let doc = OptionsDocument::empty(MC);
    assert!(doc.is_empty());
    assert_eq!(doc.render(), "");
}
