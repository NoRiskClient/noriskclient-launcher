export function isWindows(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /Windows/i.test(navigator.userAgent);
}

let rootBlurFallback: boolean | null = null;

export function needsRootBlurFallback(): boolean {
  if (rootBlurFallback === null) {
    const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
    rootBlurFallback = /Linux|X11/i.test(ua) && !/Android/i.test(ua);
  }
  return rootBlurFallback;
}
