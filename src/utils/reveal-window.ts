import { getCurrentWindow } from "@tauri-apps/api/window";

const FALLBACK_MS = 100;

export function revealAfterFirstPaint(): void {
  let shown = false;
  const show = () => {
    if (shown) return;
    shown = true;
    getCurrentWindow().show().catch(() => {});
  };
  requestAnimationFrame(() => requestAnimationFrame(show));
  setTimeout(show, FALLBACK_MS);
}
