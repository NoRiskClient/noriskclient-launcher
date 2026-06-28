import { invoke } from "@tauri-apps/api/core";

/**
 * Reveals a file in its parent directory (e.g. Explorer/Finder).
 * Workaround: the JS `@tauri-apps/plugin-opener` sends `{ path }` but
 * the Rust plugin expects `{ paths: [...] }`, so we invoke directly.
 */
export async function revealItemInDir(path: string): Promise<void> {
  await invoke("plugin:opener|reveal_item_in_dir", { paths: [path] });
}
