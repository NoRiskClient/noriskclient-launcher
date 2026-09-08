use std::path::{Path, PathBuf};

const RUNTIME_DLLS: &[&str] = &[
    "avcodec-62.dll",
    "avformat-62.dll",
    "avutil-60.dll",
    "swresample-6.dll",
];

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_macos();
        return;
    }
    println!("cargo:rerun-if-env-changed=FFMPEG_DIR");

    if !cfg!(windows) {
        return;
    }

    let Some(ffmpeg_dir) = std::env::var_os("FFMPEG_DIR").map(PathBuf::from) else {
        return;
    };

    let bin_dir = ffmpeg_dir.join("bin");
    if !bin_dir.is_dir() {
        println!(
            "cargo:warning=FFMPEG_DIR has no bin/ ({}). Run scripts/setup-native-deps.mjs.",
            bin_dir.display()
        );
        return;
    }

    let Some(target_dir) = executable_dir() else {
        println!("cargo:warning=Could not locate the target directory; DLLs were not copied.");
        return;
    };

    for dll in RUNTIME_DLLS {
        let from = bin_dir.join(dll);
        let to = target_dir.join(dll);

        if !from.is_file() {
            println!(
                "cargo:warning=Missing {} in the FFmpeg build. A version bump may have renamed it.",
                dll
            );
            continue;
        }

        if is_up_to_date(&from, &to) {
            continue;
        }

        if let Err(e) = std::fs::copy(&from, &to) {
            println!("cargo:warning=Could not copy {dll}: {e}");
        }
    }
}

fn executable_dir() -> Option<PathBuf> {
    let out_dir = PathBuf::from(std::env::var_os("OUT_DIR")?);
    let profile_dir = out_dir.ancestors().nth(3)?;
    profile_dir.is_dir().then(|| profile_dir.to_path_buf())
}

fn is_up_to_date(from: &Path, to: &Path) -> bool {
    let (Ok(src), Ok(dst)) = (from.metadata(), to.metadata()) else {
        return false;
    };
    if src.len() != dst.len() {
        return false;
    }
    match (src.modified(), dst.modified()) {
        (Ok(a), Ok(b)) => b >= a,
        _ => false,
    }
}

fn build_macos() {
    use std::process::Command;
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "aarch64" => "arm64",
        "x86_64" => "x86_64",
        other => panic!("unsupported macOS architecture: {other}"),
    };
    println!("cargo:rerun-if-changed=native/Info.plist");
    println!(
        "cargo:rustc-link-arg-bin=norisk-capture=-Wl,-sectcreate,__TEXT,__info_plist,{}",
        std::env::current_dir()
            .unwrap()
            .join("native/Info.plist")
            .display()
    );
    let sources = [
        "native/Bridge.swift",
        "native/Capture.swift",
        "native/Media.swift",
    ];
    for source in sources {
        println!("cargo:rerun-if-changed={source}");
    }
    let target = format!("{arch}-apple-macosx11.0");
    let status = Command::new("xcrun")
        .args([
            "swiftc",
            "-swift-version",
            "5",
            "-emit-library",
            "-static",
            "-parse-as-library",
            "-O",
            "-whole-module-optimization",
            "-module-name",
            "NoRiskCapture",
            "-target",
            &target,
        ])
        .args(sources)
        .arg("-module-cache-path")
        .arg(out.join("swift-cache"))
        .arg("-o")
        .arg(out.join("libNoRiskCapture.a"))
        .status()
        .expect("Xcode Swift compiler is required for macOS clips");
    assert!(
        status.success(),
        "compiling the native macOS capture engine failed"
    );
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=NoRiskCapture");
    let compiler = Command::new("xcrun")
        .args(["--find", "swiftc"])
        .output()
        .unwrap();
    let compiler = PathBuf::from(String::from_utf8(compiler.stdout).unwrap().trim());
    let swift_lib = compiler.parent().unwrap().join("../lib/swift/macosx");
    println!("cargo:rustc-link-search=native={}", swift_lib.display());
    println!("cargo:rustc-link-search=native=/usr/lib/swift");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    for framework in [
        "Foundation",
        "AppKit",
        "ScreenCaptureKit",
        "VideoToolbox",
        "AVFoundation",
        "CoreMedia",
        "CoreVideo",
        "CoreGraphics",
        "AudioToolbox",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
}
