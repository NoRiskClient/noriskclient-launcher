use tauri::command;
use std::fs;
use base64::{Engine as _, engine::general_purpose};

#[command]
pub async fn load_image_as_base64(image_path: String) -> Result<String, String> {
    match fs::read(image_path) {
        Ok(image_data) => {
            let base64_string = general_purpose::STANDARD.encode(&image_data);
            Ok(format!("data:image/png;base64,{}", base64_string))
        }
        Err(e) => Err(format!("Failed to read image: {}", e))
    }
}
