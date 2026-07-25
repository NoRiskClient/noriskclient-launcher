"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@iconify/react";
import { cn } from "../lib/utils";
import { FONT_PRESETS } from "../config/fonts";
import { CUSTOM_FONT_ID, useFontStore } from "../store/font-store";
import { Combobox } from "./ui/Combobox";

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
  const { fontId, setFont, customFamily, setCustomFamily } = useFontStore();
  const presets = Object.values(FONT_PRESETS);
  const isCustom = fontId === CUSTOM_FONT_ID;

  const [fonts, setFonts] = useState<string[]>(COMMON_FONTS);

  useEffect(() => {
    if (!isCustom) return;
    invoke<string[]>("list_system_fonts")
      .then((list) => {
        if (Array.isArray(list) && list.length) setFonts(list);
      })
      .catch((err) => console.warn("[FontSelector] list_system_fonts failed:", err));
  }, [isCustom]);

  const tileClass = (selected: boolean) =>
    cn(
      "relative flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-all duration-200",
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
              key={preset.id}
              onClick={() => {
                if (!disabled) setFont(preset.id);
              }}
              disabled={disabled}
              className={tileClass(isSelected)}
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-md border-2 border-white/20 flex items-center justify-center text-lg leading-none text-white transition-transform",
                  isSelected && "scale-105",
                )}
                style={{ fontFamily: preset.preview }}
              >
                Aa
              </div>
              <span
                className={cn("text-base transition-colors", isSelected ? "text-white" : "text-white/80")}
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
          onClick={() => {
            if (!disabled) setFont(CUSTOM_FONT_ID);
          }}
          disabled={disabled}
          className={tileClass(isCustom)}
        >
          <div
            className={cn(
              "w-8 h-8 rounded-md border-2 border-white/20 flex items-center justify-center text-lg leading-none text-white transition-transform",
              isCustom && "scale-105",
            )}
            style={customFamily ? { fontFamily: `"${customFamily}", sans-serif` } : undefined}
          >
            <Icon icon="solar:pen-bold" className="w-4 h-4" />
          </div>
          <span
            className={cn("text-base transition-colors", isCustom ? "text-white" : "text-white/80")}
            style={customFamily ? { fontFamily: `"${customFamily}", sans-serif` } : undefined}
          >
            {customFamily?.trim() ? customFamily : "Custom"}
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
            placeholder="Pick or type a font (e.g. Comic Sans MS, Inter)"
            inputStyle={customFamily ? { fontFamily: `"${customFamily}", sans-serif` } : undefined}
            optionStyle={(f) => ({ fontFamily: `"${f}", sans-serif` })}
          />
          <span className="text-xs text-white/40 font-minecraft">{fonts.length} fonts available</span>
        </div>
      )}
    </div>
  );
}
