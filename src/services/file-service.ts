import { invoke } from "@tauri-apps/api/core";

/** file_command::delete_file expects file_path (Tauri's JS key is filePath). */
export function deleteFile(filePath: string): Promise<void> {
  return invoke<void>("delete_file", { filePath });
}
