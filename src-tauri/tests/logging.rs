use log::{Level, Record};
use log4rs::encode::writer::simple::SimpleWriter;
use log4rs::encode::Encode;
use noriskclient_launcher_v3_lib::logging::*;

#[test]
fn encoder_masks_the_rendered_line() {
    let encoder = RedactingEncoder::new(LOG_PATTERN);
    let mut out = Vec::new();
    encoder
        .encode(
            &mut SimpleWriter(&mut out),
            &Record::builder()
                .level(Level::Info)
                .args(format_args!(
                    r"Executing command: C:\Users\someone\AppData\javaw.exe --clientId abcdef123"
                ))
                .build(),
        )
        .unwrap();

    let line = String::from_utf8(out).unwrap();
    assert!(!line.contains("someone"), "os username leaked: {}", line);
    assert!(line.contains(r"C:\Users\*****\AppData"));
    assert!(line.contains("--clientId *****"));
}
