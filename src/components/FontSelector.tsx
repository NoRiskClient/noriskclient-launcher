"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@iconify/react";
import { cn } from "../lib/utils";
import { FONT_PRESETS } from "../config/fonts";
import { CUSTOM_FONT_ID, useFontStore } from "../store/font-store";
import { Combobox } from "./ui/Combobox";
import { useTranslation } from "react-i18next";
import { useAnimationsEnabled } from "../hooks/useEntranceAnimation";

interface FontSelectorProps {
  disabled?: boolean;
}

const COMMON_FONTS = [
  "Arial", "Calibri", "Cambria", "Candara", "Comic Sans MS", "Consolas",
  "Constantia", "Corbel", "Courier New", "Georgia", "Impact", "Lucida Console",
  "Palatino Linotype", "Segoe UI", "Tahoma", "Times New Roman", "Trebuchet MS",
  "Verdana", "Inter", "Roboto", "Open Sans", "monospace", "serif", "sans-serif",
];

export function FontSelector({ disabled }: FontSelectorProps) {
  const { t } = useTranslation();
  const animationsEnabled = useAnimationsEnabled();
  const { fontId, setFont, customFamily, setCustomFamily } = useFontStore();
  const presets = Object.values(FONT_PRESETS);
  const isCustom = fontId === CUSTOM_FONT_ID;

  const [fonts, setFonts] = useState<string[]>(COMMON_FONTS);
  const [fontStatus, setFontStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!isCustom) return;
    let active = true;
    setFontStatus("loading");
    invoke<string[]>("list_system_fonts")
      .then((list) => {
        if (!active) return;
        if (!Array.isArray(list) || list.some(font => typeof font !== "string")) throw new Error("Invalid system font response");
        setFonts([...new Set(list.filter(font => font.trim()))]);
        setFontStatus("ready");
      })
      .catch((err) => {
        if (!active) return;
        console.warn("[FontSelector] list_system_fonts failed:", err);
        setFonts(COMMON_FONTS); setFontStatus("error");
      });
    return () => { active = false; };
  }, [isCustom, retry]);

  const tileClass = (selected: boolean) =>
    cn(
      "relative flex max-w-full items-center gap-3 pl-4 pr-10 py-3 rounded-lg border-2",
      animationsEnabled ? "transition-all duration-200" : "transition-none",
      selected ? "border-white/60 bg-white/10" : "border-[#ffffff20] bg-black/20",
      disabled
        ? "opacity-40 cursor-not-allowed"
        : "hover:border-[#ffffff40] hover:bg-white/5 cursor-pointer",
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        {presets.map((preset) => {
          const isSelected = fontId === preset.id;
          return (
            <button
              type="button"
              aria-pressed={isSelected}
              key={preset.id}
              onClick={() => {
                if (!disabled) setFont(preset.id);
              }}
              disabled={disabled}
              className={tileClass(isSelected)}
            >
              <div
                className={cn(
                  "w-8 h-8 shrink-0 rounded-md border-2 border-white/20 flex items-center justify-center text-lg leading-none text-white",
                  animationsEnabled ? "transition-transform" : "transition-none",
                  isSelected && "scale-105",
                )}
                style={{ fontFamily: preset.preview }}
              >
                Aa
              </div>
              <span
                className={cn("min-w-0 whitespace-normal [overflow-wrap:anywhere] text-left text-base", animationsEnabled ? "transition-colors" : "transition-none", isSelected ? "text-white" : "text-white/80")}
                style={{ fontFamily: preset.preview }}
              >
                {preset.name}
              </span>
              {isSelected && (
                <Icon icon="solar:check-circle-bold" className="w-5 h-5 text-white absolute top-2 right-2" />
              )}
            </button>
          );
        })}

        <button
          type="button"
          aria-pressed={isCustom}
          onClick={() => {
            if (!disabled) setFont(CUSTOM_FONT_ID);
          }}
          disabled={disabled}
          className={tileClass(isCustom)}
        >
          <div
            className={cn(
              "w-8 h-8 shrink-0 rounded-md border-2 border-white/20 flex items-center justify-center text-lg leading-none text-white",
              animationsEnabled ? "transition-transform" : "transition-none",
              isCustom && "scale-105",
            )}
            style={customFamily ? { fontFamily: `"${customFamily}", sans-serif` } : undefined}
          >
            <Icon icon="solar:pen-bold" className="w-4 h-4" />
          </div>
          <span
            className={cn("min-w-0 whitespace-normal [overflow-wrap:anywhere] text-left text-base", animationsEnabled ? "transition-colors" : "transition-none", isCustom ? "text-white" : "text-white/80")}
            style={customFamily ? { fontFamily: `"${customFamily}", sans-serif` } : undefined}
          >
            {customFamily?.trim() ? customFamily : t("settings.font.custom")}
          </span>
          {isCustom && (
            <Icon icon="solar:check-circle-bold" className="w-5 h-5 text-white absolute top-2 right-2" />
          )}
        </button>
      </div>

      {isCustom && (
        <div className="flex flex-col gap-1.5 max-w-md">
          <Combobox
            value={customFamily}
            onChange={setCustomFamily}
            options={fonts}
            disabled={disabled}
            allowClear
            placeholder={t("settings.font.pick_or_type")}
            aria-label={t("settings.font.custom_family")}
            inputStyle={customFamily ? { fontFamily: `"${customFamily}", sans-serif` } : undefined}
            optionStyle={(f) => ({ fontFamily: `"${f}", sans-serif` })}
          />
          <div className="grid min-h-[20px] text-xs text-white/60 font-minecraft" aria-live="polite">
            <span aria-hidden={fontStatus !== "loading"} className={cn("col-start-1 row-start-1", fontStatus !== "loading" && "invisible")}>
              {t("settings.font.loading")}
            </span>
            <span aria-hidden={fontStatus !== "ready"} className={cn("col-start-1 row-start-1", fontStatus !== "ready" && "invisible")}>
              {t("settings.font.available", { count: fonts.length })}
            </span>
            <div role={fontStatus === "error" ? "alert" : undefined} aria-hidden={fontStatus !== "error"}
              className={cn("col-start-1 row-start-1 flex items-start gap-2 text-amber-200/90", fontStatus !== "error" && "invisible")}>
                <span className="min-w-0 flex-1">{t("settings.font.load_failed_suggestions", { count: COMMON_FONTS.length })}</span>
                <button type="button" disabled={disabled || fontStatus !== "error"} onClick={() => setRetry(value => value + 1)}
                  className="shrink-0 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded">
                  {t("common.try_again")}
                </button>
              </div>
          </div>
        </div>
      )}
    </div>
  );
}
