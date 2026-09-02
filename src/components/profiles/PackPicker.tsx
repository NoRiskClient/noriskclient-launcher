"use client";

import { useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../store/useThemeStore";
import { hasHiddenPacks, packGroups, type Packs } from "../../utils/pack-listing";
import {
  ThemedDropdown,
  ThemedDropdownDivider,
  ThemedDropdownHeader,
  ThemedDropdownItem,
} from "./v3/shared/ThemedDropdown";

interface PackPickerProps {
  packs: Packs;
  value: string | null;
  onChange: (packId: string | null) => void;
  allowNone?: boolean;
  label?: string;
  size?: "sm" | "md";
  loading?: boolean;
  className?: string;
}

export function PackPicker({
  packs,
  value,
  onChange,
  allowNone = true,
  label,
  size = "md",
  loading = false,
  className = "",
}: PackPickerProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const groups = useMemo(() => packGroups(packs, value, showHidden), [packs, value, showHidden]);
  const hasHidden = useMemo(() => hasHiddenPacks(packs, value), [packs, value]);
  const pending = loading && Object.keys(packs).length === 0;

  const selectedLabel = useMemo(() => {
    if (!value) return t("profiles.v3.pack.noSelection");
    return groups.flatMap(g => g.items).find(o => o.id === value)?.label ?? value;
  }, [groups, value, t]);

  const pick = (packId: string | null) => {
    onChange(packId);
    setOpen(false);
  };

  const isSm = size === "sm";

  return (
    <div className={className}>
      {label && (
        <label className="block text-white font-smallcaps text-lg mb-2">{label}</label>
      )}
      <div className="relative">
        <button
          ref={triggerRef}
          disabled={pending}
          onClick={() => setOpen(v => !v)}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${accentColor.value}33`; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = `${accentColor.value}1a`; }}
          style={{ backgroundColor: `${accentColor.value}1a`, borderColor: `${accentColor.value}40` }}
          className={`rounded-md border font-minecraft text-white flex items-center gap-1.5 transition-colors ${
            isSm ? "h-8 px-2.5 text-xs max-w-[220px]" : "w-full h-11 px-3 text-base justify-between"
          } ${pending ? "opacity-60 cursor-default" : ""}`}
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <Icon
              icon={pending ? "svg-spinners:ring-resize" : "solar:shield-check-bold"}
              className={`flex-shrink-0 ${isSm ? "w-3.5 h-3.5" : "w-4 h-4"}`}
              style={{ color: accentColor.value }}
            />
            <span className="truncate">{pending ? "" : selectedLabel}</span>
          </span>
          <Icon
            icon="solar:alt-arrow-down-linear"
            className={`opacity-60 flex-shrink-0 transition-transform ${isSm ? "w-3 h-3" : "w-4 h-4"} ${open ? "rotate-180" : ""}`}
          />
        </button>

        <ThemedDropdown
          open={open && !pending}
          onClose={() => setOpen(false)}
          width="w-60"
          align="left"
          scrollable
          triggerRef={triggerRef}
          matchTriggerWidth={!isSm}
        >
          {allowNone && (
            <>
              <ThemedDropdownItem
                icon="solar:close-circle-linear"
                selected={!value}
                onClick={() => pick(null)}
              >
                {t("profiles.v3.pack.noSelection")}
              </ThemedDropdownItem>
              {groups.length > 0 && <ThemedDropdownDivider />}
            </>
          )}

          {groups.map((group, i) => (
            <div key={group.category || "__main"}>
              {group.category && (
                <>
                  {(i > 0 || allowNone) && <ThemedDropdownDivider />}
                  <ThemedDropdownHeader>{group.category}</ThemedDropdownHeader>
                </>
              )}
              {group.items.map(opt => (
                <ThemedDropdownItem
                  key={opt.id}
                  icon={opt.hidden ? "solar:test-tube-bold" : "solar:shield-check-bold"}
                  selected={value === opt.id}
                  onClick={() => pick(opt.id)}
                >
                  <span className="truncate">{opt.label}</span>
                </ThemedDropdownItem>
              ))}
            </div>
          ))}

          {(hasHidden || showHidden) && (
            <>
              <ThemedDropdownDivider />
              <ThemedDropdownItem
                icon={showHidden ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"}
                onClick={() => setShowHidden(v => !v)}
              >
                {showHidden ? t("profiles.v3.pack.showLess") : t("profiles.v3.pack.showMore")}
              </ThemedDropdownItem>
            </>
          )}
        </ThemedDropdown>
      </div>
    </div>
  );
}
