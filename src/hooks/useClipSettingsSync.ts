import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";

import { applyClipSettings } from "../services/clip-service";
import { useClipsStore } from "../store/clips-store";
import type { LauncherConfig } from "../types/launcherConfig";
import { isWindows } from "../utils/platform";

function hotkeySignature(config: LauncherConfig): string {
  const clips = config.clips;
  return `${clips.enabled}|${clips.hotkey_save}|${clips.hotkey_toggle}`;
}

export function useClipSettingsSync(config: LauncherConfig | null, saving: boolean): void {
  const { t } = useTranslation();
  const setEnabled = useClipsStore((state) => state.set);
  const setApplying = useClipsStore((state) => state.setApplying);
  const appliedRef = useRef<string>("");
  const hotkeysRef = useRef<string>("");

  useEffect(() => {
    if (!config) return;
    setEnabled(Boolean(config.clips?.enabled));
  }, [config, setEnabled]);

  useEffect(() => {
    if (!config || saving || !isWindows()) return;

    const signature = JSON.stringify(config.clips);
    if (appliedRef.current === "") {
      appliedRef.current = signature;
      hotkeysRef.current = hotkeySignature(config);
      return;
    }
    if (appliedRef.current === signature) return;
    appliedRef.current = signature;

    const keysNow = hotkeySignature(config);
    const keysChanged = hotkeysRef.current !== keysNow;
    hotkeysRef.current = keysNow;

    setApplying(true);
    applyClipSettings()
      .then((keys) => {
        if (config.clips.enabled && keysChanged && keys.length > 0) {
          toast.success(t("settings.clips.applied", { keys: keys.join(", ") }));
        }
      })
      .catch((error) => {
        toast.error(t("settings.clips.apply_failed", { error: String(error) }));
      })
      .finally(() => setApplying(false));
  }, [config, saving, setApplying, t]);
}
