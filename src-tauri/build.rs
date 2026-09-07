fn main() {
    println!("cargo:rerun-if-env-changed=NRC_CAPTURE_RUNTIME_SHA256");
    println!("cargo:rerun-if-env-changed=NRC_CAPTURE_RUNTIME_URL");
    tauri_build::build()
}
