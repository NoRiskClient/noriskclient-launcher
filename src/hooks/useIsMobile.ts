// Mobile detection for the Tauri mobile app (Android/iOS WebView).
// Device type cannot change at runtime, so a module-level constant is enough.
export const IS_MOBILE_DEVICE =
  typeof navigator !== "undefined" &&
  /android|iphone|ipad|ipod/i.test(navigator.userAgent);

export function useIsMobile(): boolean {
  return IS_MOBILE_DEVICE;
}
