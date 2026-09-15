import { invoke, isTauri } from "@tauri-apps/api/core";

let macOSClipsSupported = false;

export async function initializeClipSupport(): Promise<void> {
  if (isMacOS() && isTauri()) {
    macOSClipsSupported = await invoke<boolean>("capture_supported");
  }
}

export function isWindows(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /Windows/i.test(navigator.userAgent);
}

export function isMacOS(): boolean {
  return typeof navigator !== "undefined" && /Macintosh/i.test(navigator.userAgent);
}

export function supportsClips(): boolean {
  return isWindows() || (isMacOS() && macOSClipsSupported);
}
