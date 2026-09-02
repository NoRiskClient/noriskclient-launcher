use std::path::{Path, PathBuf};

const RUNTIME_DLLS: &[&str] = &[
    "avcodec-62.dll",
    "avformat-62.dll",
    "avutil-60.dll",
    "swresample-6.dll",
];

fn main() {
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
