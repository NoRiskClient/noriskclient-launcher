import { isMobile } from "./platform";

export function tapHaptic() {
  if (!isMobile) return;
  import("@tauri-apps/plugin-haptics")
    .then((haptics) => haptics.impactFeedback("light"))
    .catch(() => {});
}
