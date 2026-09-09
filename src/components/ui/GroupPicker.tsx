"use client";

import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

import { SearchStyleInput } from "./Input";
import { Tooltip } from "./Tooltip";
import { useThemeStore } from "../../store/useThemeStore";

interface GroupPickerProps {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  noneLabel?: string;
  newLabel?: string;
}

export function GroupPicker({
  value,
  onChange,
  options,
  noneLabel,
  newLabel,
}: GroupPickerProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor).value;
  const [isTyping, setIsTyping] = useState(false);
  const showInput = isTyping || (value !== "" && !options.includes(value));

  const chipStyle = (active: boolean) =>
    active
      ? {
          borderColor: accentColor,
          backgroundColor: `${accentColor}30`,
          color: "#fff",
        }
      : {
          borderColor: "rgba(255,255,255,0.12)",
          backgroundColor: "rgba(255,255,255,0.04)",
          color: "rgba(255,255,255,0.65)",
        };

  if (showInput) {
    return (
      <div className="flex items-center gap-2">
        <SearchStyleInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("placeholders.group_name")}
          className="text-sm w-full"
          autoFocus
        />
        <Tooltip content={t("common.cancel")} wrapperClassName="shrink-0">
          <button
            type="button"
            onClick={() => {
              onChange("");
              setIsTyping(false);
            }}
            className="p-2 rounded-lg border border-white/10 text-white/50 hover:text-white hover:border-white/25 transition-colors"
          >
            <Icon icon="solar:close-circle-linear" className="w-5 h-5" />
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onChange("")}
        className="px-3 py-1.5 rounded-lg border font-minecraft text-sm tracking-wide transition-colors"
        style={chipStyle(value === "")}
      >
        {noneLabel ?? t("profiles.import.group_none")}
      </button>

      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className="px-3 py-1.5 rounded-lg border font-minecraft text-sm tracking-wide transition-colors"
          style={chipStyle(value === option)}
        >
          {option}
        </button>
      ))}

      <button
        type="button"
        onClick={() => {
          onChange("");
          setIsTyping(true);
        }}
        className="px-3 py-1.5 rounded-lg border border-dashed border-white/20 text-white/50 hover:text-white hover:border-white/40 font-minecraft text-sm tracking-wide transition-colors flex items-center gap-1.5"
      >
        <Icon icon="solar:add-circle-linear" className="w-4 h-4" />
        {newLabel ?? t("profiles.import.group_new")}
      </button>
    </div>
  );
}
