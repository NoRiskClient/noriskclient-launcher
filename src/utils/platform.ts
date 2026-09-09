export function isWindows(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /Windows/i.test(navigator.userAgent);
}
