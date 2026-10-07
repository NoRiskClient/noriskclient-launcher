"use client";

import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../lib/utils";
import { useLauncherTheme } from "../hooks/useLauncherTheme";
import { LAUNCHER_THEMES } from "../store/launcher-theme-store";
import { SimpleTooltip } from "./ui/Tooltip";
import { getLauncherConfig } from "../services/launcher-config-service";
import { useTranslation } from "react-i18next";

interface ThemeSelectorProps {
  disabled?: boolean;
}

export function ThemeSelector({ disabled }: ThemeSelectorProps) {
  const { t } = useTranslation();
  const [debugFlag, setDebugFlag] = useState(false);
  const { selectedThemeId, toggleTheme, isThemeUnlocked } = useLauncherTheme();
  const themes = Object.values(LAUNCHER_THEMES);

  // Load launcher config to check experimental mode
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await getLauncherConfig();
        setDebugFlag(config.is_experimental);
      } catch (err) {
        console.error("Failed to load launcher config:", err);
        // Default to false if config can't be loaded
        setDebugFlag(false);
      }
    };

    loadConfig();
  }, []);

  return (
    <div className="flex flex-wrap gap-3">
      {themes.map((theme) => {
        const isUnlocked = debugFlag || isThemeUnlocked(theme.id);
        const isSelected = selectedThemeId === theme.id;

        const button = (
          <button
            key={theme.id}
            onClick={() => {
              if (!disabled && isUnlocked) {
                toggleTheme(theme.id);
              }
            }}
            disabled={disabled || (!debugFlag && !isThemeUnlocked(theme.id))}
            className={cn(
              "relative flex max-w-full items-center gap-3 pl-4 pr-10 py-3 rounded-lg border-2 transition-all duration-200",
              isSelected
                ? "border-white/60 bg-white/10"
                : "border-[#ffffff20] bg-black/20",
              (!debugFlag && !isThemeUnlocked(theme.id))
                ? "opacity-40 cursor-not-allowed grayscale"
                : disabled
                  ? "opacity-40 cursor-not-allowed"
                  : "hover:border-[#ffffff40] hover:bg-white/5 cursor-pointer"
            )}
          >
            <div
              className={cn(
                "w-8 h-8 shrink-0 rounded-md border-2 shadow-lg transition-transform",
                (!debugFlag && !isThemeUnlocked(theme.id)) ? "border-white/10" : "border-white/20",
                isSelected && "scale-105"
              )}
              style={{
                backgroundColor: theme.accentColor.value,
                boxShadow: isSelected ? `0 0 12px ${theme.accentColor.value}50` : undefined,
              }}
            />
            <div className="min-w-0 flex flex-col items-start text-left">
              <span
                className={cn(
                  "whitespace-normal [overflow-wrap:anywhere] font-minecraft text-base transition-colors",
                  isSelected ? "text-white" : "text-white/80"
                )}
              >
                {theme.name}
              </span>
              {(!debugFlag && !isThemeUnlocked(theme.id)) && theme.unlockRequirement && (
                <span className="whitespace-normal [overflow-wrap:anywhere] text-xs text-white/40 font-minecraft">
                  {theme.unlockRequirement.type === "advent-door" && (
                    <>{t('settings.theme.unlock_advent_door', { day: theme.unlockRequirement.day })}</>
                  )}
                </span>
              )}
            </div>
            {((!debugFlag && !isThemeUnlocked(theme.id)) || isSelected) && (
              <div className="absolute top-2 right-2 w-5 flex flex-col items-center gap-1" aria-hidden="true">
                {(!debugFlag && !isThemeUnlocked(theme.id)) && (
                  <Icon icon="solar:lock-keyhole-bold" className="w-4 h-4 text-white/40" />
                )}
                {isSelected && (
                  <Icon icon="solar:check-circle-bold" className="w-5 h-5 text-white" />
                )}
              </div>
            )}
          </button>
        );

        if (!debugFlag && !isThemeUnlocked(theme.id)) {
          return (
            <SimpleTooltip
              key={theme.id}
              content={t('settings.theme.unlock_advent_tooltip', { day: theme.unlockRequirement?.day })}
              wrapperClassName="max-w-full min-w-0"
            >
              {button}
            </SimpleTooltip>
          );
        }

        return button;
      })}
    </div>
  );
}

