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

export function isLinux(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Linux/i.test(navigator.userAgent) &&
    !/Android/i.test(navigator.userAgent)
  );
}

export function disableBackdropBlurOnLinux(): void {
  if (isLinux()) {
    document.documentElement.classList.add("no-backdrop-blur");
  }
}

export function supportsClips(): boolean {
  return isWindows() || (isMacOS() && macOSClipsSupported);
}
