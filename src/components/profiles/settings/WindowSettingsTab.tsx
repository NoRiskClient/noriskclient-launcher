"use client";

import { useEffect, useRef } from "react";
import type { Profile } from "../../../types/profile";
import { useThemeStore } from "../../../store/useThemeStore";
import { Checkbox } from "../../ui/Checkbox";
import { Label } from "../../ui/Label";
import { SearchStyleInput } from "../../ui/Input";
import { gsap } from "gsap";
import { cn } from "../../../lib/utils";
import { useTranslation } from "react-i18next";

interface WindowSettingsTabProps {
  editedProfile: Profile;
  updateProfile: (updates: Partial<Profile>) => void;
}

export function WindowSettingsTab({
  editedProfile,
  updateProfile,
}: WindowSettingsTabProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const tabRef = useRef<HTMLDivElement>(null);
  const resolutionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isBackgroundAnimationEnabled) {
      if (tabRef.current) {
        gsap.fromTo(
          tabRef.current,
          { opacity: 0 },
          { opacity: 1, duration: 0.4, ease: "power2.out" },
        );
      }

      if (resolutionRef.current) {
        gsap.fromTo(
          resolutionRef.current,
          { opacity: 0, y: 20 },
          {
            opacity: 1,
            y: 0,
            duration: 0.4,
            ease: "power2.out",
            delay: 0.2,
          },
        );
      }
    }
  }, [isBackgroundAnimationEnabled]);

  const resolutionPresets = [
    { width: 854, height: 480, label: "Default" },
    { width: 1280, height: 720, label: "720p" },
    { width: 1920, height: 1080, label: "1080p" },
    { width: 2560, height: 1440, label: "1440p" },
    { width: 3840, height: 2160, label: "4k" },
  ];

  const handleResolutionChange = (width: number, height: number) => {
    const newSettings = { ...editedProfile.settings };
    if (!newSettings.resolution) {
      newSettings.resolution = { width, height };
    } else {
      newSettings.resolution.width = width;
      newSettings.resolution.height = height;
    }
    updateProfile({ settings: newSettings });
  };

  const handleFullscreenChange = (fullscreen: boolean) => {
    const newSettings = { ...editedProfile.settings };
    newSettings.fullscreen = fullscreen;
    updateProfile({ settings: newSettings });
  };

  const handlePresetClick = (preset: { width: number; height: number }) => {
    if (isBackgroundAnimationEnabled) {
      gsap.fromTo(
        `.preset-${preset.width}x${preset.height}`,
        { scale: 0.95 },
        {
          scale: 1,
          duration: 0.3,
          ease: "elastic.out(1.2, 0.4)",
        },
      );
    }

    handleResolutionChange(preset.width, preset.height);
  };

  return (
    <div ref={tabRef} className="space-y-6 select-none">
      <div>
        <h3 className="text-3xl font-minecraft text-white mb-2 lowercase">
          {t('profiles.settings.windowSettings')}
        </h3>
        <p className="text-xs text-white/70 mb-4 font-minecraft-ten tracking-wide select-none">
          {t('profiles.settings.windowDescription')}
        </p>
      </div>

      <div ref={resolutionRef} className="space-y-4">
        <div>
          <h3 className="text-3xl font-minecraft text-white mb-3 lowercase">
            {t('profiles.settings.resolution')}
          </h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xl text-white/70 font-minecraft mb-2 lowercase tracking-wide select-none">
                  {t('profiles.settings.width')}
                </label>
                <SearchStyleInput
                  type="number"
                  value={String(
                    editedProfile.settings?.resolution?.width || 854,
                  )}
                  onChange={(e) => {
                    const width = Number.parseInt(e.target.value) || 854;
                    handleResolutionChange(
                      width,
                      editedProfile.settings?.resolution?.height || 480,
                    );
                  }}
                  className="text-xl"
                />
              </div>
              <div>
                <label className="block text-xl text-white/70 font-minecraft mb-2 lowercase tracking-wide select-none">
                  {t('profiles.settings.height')}
                </label>
                <SearchStyleInput
                  type="number"
                  value={String(
                    editedProfile.settings?.resolution?.height || 480,
                  )}
                  onChange={(e) => {
                    const height = Number.parseInt(e.target.value) || 480;
                    handleResolutionChange(
                      editedProfile.settings?.resolution?.width || 854,
                      height,
                    );
                  }}
                  className="text-xl"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {resolutionPresets.map((preset) => (
                <Label
                  key={preset.label}
                  variant={
                    editedProfile.settings?.resolution?.width ===
                      preset.width &&
                    editedProfile.settings?.resolution?.height === preset.height
                      ? "default"
                      : "ghost"
                  }
                  size="md"
                  className={cn(
                    "cursor-pointer text-xl preset-${preset.width}x${preset.height}",
                    editedProfile.settings?.resolution?.width ===
                      preset.width &&
                      editedProfile.settings?.resolution?.height ===
                        preset.height
                      ? "bg-accent/20 border-accent text-white"
                      : "bg-black/20 hover:bg-black/30 border-white/10 text-white/80",
                  )}
                  onClick={() => handlePresetClick(preset)}
                >
                  {preset.label}
                </Label>
              ))}
            </div>

          <Checkbox
            checked={editedProfile.settings?.fullscreen || false}
            onChange={(e) => handleFullscreenChange(e.target.checked)}
            label={t('profiles.settings.fullscreen')}
            className="text-2xl"
            variant="flat"
          />
        </div>
      </div>
    </div>
  );
}
