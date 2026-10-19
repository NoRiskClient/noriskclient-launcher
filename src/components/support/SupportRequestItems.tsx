"use client";

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { getSupportItemDefinition, supportItemKey } from "./supportItems";

export function SupportKidItemRow({
  type,
  selected,
  summary,
  disabled,
  onOpen,
}: {
  type: string;
  selected: boolean;
  summary?: string | null;
  disabled?: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors",
        "hover:bg-white/5 focus-visible:outline-none focus-visible:bg-white/10",
        !selected && "opacity-50",
        disabled && "pointer-events-none",
      )}
    >
      <Icon icon={getSupportItemDefinition(type)?.icon ?? "solar:question-circle-bold"} className="w-6 h-6 shrink-0 text-white/80" />
      <div className="min-w-0 flex-1">
        <div className="font-minecraft text-base text-white tracking-wide leading-tight line-clamp-2 break-words">
          {t(supportItemKey(type, "label"))}
        </div>
        <div className="font-minecraft text-sm text-white/55 tracking-wide leading-tight truncate">
          {selected ? summary || t(supportItemKey(type, "description")) : t("support_request.data.deselected")}
        </div>
      </div>
      <Icon icon="solar:alt-arrow-right-linear" className="w-5 h-5 shrink-0 text-white/35" />
    </button>
  );
}
