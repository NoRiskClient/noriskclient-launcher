import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { useTranslation } from "react-i18next";

import type { Profile, ProfilePatch } from "../../../types/profile";
import { TYPING_SAVE_DELAY_MS } from "../../../utils/profile-patch";
import { useThemeStore } from "../../../store/useThemeStore";
import { SearchStyleInput } from "../../ui/Input";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { Chip, Section } from "./SettingsSection";

interface WindowSettingsTabProps {
  editedProfile: Profile;
  updateProfile: (patch: ProfilePatch, delayMs?: number) => void;
}

const DEFAULT_WIDTH = 854;
const DEFAULT_HEIGHT = 480;

const RESOLUTION_PRESETS = [
  { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, label: "Default" },
  { width: 1280, height: 720, label: "720p" },
  { width: 1920, height: 1080, label: "1080p" },
  { width: 2560, height: 1440, label: "1440p" },
  { width: 3840, height: 2160, label: "4K" },
];

export function WindowSettingsTab({ editedProfile, updateProfile }: WindowSettingsTabProps) {
  const { t } = useTranslation();
  const accent = useThemeStore((state) => state.accentColor.value);
  const isBackgroundAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
  const tabRef = useRef<HTMLDivElement>(null);

  const width = editedProfile.settings?.resolution?.width || DEFAULT_WIDTH;
  const height = editedProfile.settings?.resolution?.height || DEFAULT_HEIGHT;

  useEffect(() => {
    if (isBackgroundAnimationEnabled && tabRef.current) {
      gsap.fromTo(tabRef.current, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" });
    }
  }, [isBackgroundAnimationEnabled]);

  const setResolution = (nextWidth: number, nextHeight: number, delayMs = 0) =>
    updateProfile({ settings: { resolution: { width: nextWidth, height: nextHeight } } }, delayMs);

  const sizeInput = (value: number, fallback: number, onValue: (value: number) => void) => (
    <SearchStyleInput
      type="number"
      value={String(value)}
      onChange={(e) => onValue(Number.parseInt(e.target.value) || fallback)}
      className="text-sm tabular-nums"
    />
  );

  return (
    <div ref={tabRef} className="space-y-4 select-none">
      <Section title={t("profiles.settings.resolution")} description={t("profiles.settings.windowDescription")}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {RESOLUTION_PRESETS.map((preset) => (
              <Chip
                key={preset.label}
                active={preset.width === width && preset.height === height}
                accent={accent}
                onClick={() => setResolution(preset.width, preset.height)}
                className="flex flex-col items-center px-3 py-1.5"
              >
                <span className="text-sm">{preset.label}</span>
                <span className="text-[10px] text-white/40">
                  {preset.width}×{preset.height}
                </span>
              </Chip>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 space-y-1.5">
              <span className="block font-minecraft text-xs text-white/50">{t("profiles.settings.width")}</span>
              {sizeInput(width, DEFAULT_WIDTH, (value) => setResolution(value, height, TYPING_SAVE_DELAY_MS))}
            </label>
            <span className="pb-3 font-minecraft text-white/40">×</span>
            <label className="min-w-0 flex-1 space-y-1.5">
              <span className="block font-minecraft text-xs text-white/50">{t("profiles.settings.height")}</span>
              {sizeInput(height, DEFAULT_HEIGHT, (value) => setResolution(width, value, TYPING_SAVE_DELAY_MS))}
            </label>
          </div>
        </div>
      </Section>

      <Section
        title={t("profiles.settings.fullscreen")}
        aside={
          <ToggleSwitch
            checked={editedProfile.settings?.fullscreen || false}
            onChange={(fullscreen) => updateProfile({ settings: { fullscreen } })}
            size="sm"
          />
        }
      />
    </div>
  );
}
