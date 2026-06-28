"use client";

import type React from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

export interface FABActionConfig {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "danger" | "default";
}

interface FloatingActionBarProps {
  visible: boolean;
  count: number;
  totalCount: number;
  accent: string;
  allSelected: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  actions: FABActionConfig[];
  batchProgress?: { current: number; total: number } | null;
}

export function FloatingActionBar({
  visible, count, totalCount, accent, allSelected,
  onSelectAll, onClear, actions, batchProgress,
}: FloatingActionBarProps) {
  const { t } = useTranslation();
  return (
    <div
      className={`absolute left-1/2 -translate-x-1/2 bottom-5 z-30 transition-all duration-200 ease-out ${
        visible ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-4 pointer-events-none"
      }`}
    >
      <div
        style={{
          backgroundColor: `${accent}1f`,
          borderColor: `${accent}66`,
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          boxShadow: `0 12px 32px -10px rgba(0,0,0,0.5)`,
        }}
        className="flex items-center h-11 rounded-xl border overflow-hidden whitespace-nowrap"
      >
        <div className="flex items-center gap-2 pl-3.5 pr-2 whitespace-nowrap">
          {batchProgress ? (
            <span className="flex items-center gap-1.5 text-xs font-minecraft-ten text-white tabular-nums whitespace-nowrap">
              <Icon icon="solar:refresh-bold" className="w-3 h-3 animate-spin" style={{ color: accent }} />
              <span style={{ color: accent }}>{batchProgress.current}</span>
              <span className="text-white/40">/ {batchProgress.total}</span>
            </span>
          ) : (
            <>
              <span className="text-xs font-minecraft-ten text-white tabular-nums whitespace-nowrap">
                <span style={{ color: accent }}>{count}</span>
                <span className="text-white/40"> / {totalCount}</span>
              </span>
              {!allSelected && (
                <button
                  onClick={onSelectAll}
                  className="h-7 px-2 rounded-md text-[10px] font-minecraft-ten uppercase tracking-wider text-white/55 hover:text-white hover:bg-white/10 transition-colors"
                >
                  {t("profiles.v3.fab.all")}
                </button>
              )}
            </>
          )}
        </div>

        <div className="w-px h-5" style={{ backgroundColor: `${accent}33` }} />

        {actions.map((action, i) => (
          <FabButton key={`${action.label}-${i}`} {...action} />
        ))}

        <div className="w-px h-5" style={{ backgroundColor: `${accent}33` }} />

        <button
          onClick={onClear}
          className="h-11 w-11 hover:bg-white/5 text-white/55 hover:text-white flex items-center justify-center transition-colors"
          title={t("profiles.v3.fab.clearSelection")}
        >
          <Icon icon="solar:close-circle-linear" className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

const FabButton: React.FC<FABActionConfig> = ({ icon, label, tone, onClick, disabled }) => {
  const toneClass =
    tone === "danger" ? "text-white/80 hover:bg-rose-500/20 hover:text-rose-100" :
    "text-white/80 hover:bg-white/10 hover:text-white";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative h-8 px-2.5 mx-0.5 rounded-md flex items-center gap-1.5 text-xs font-minecraft-ten transition-colors disabled:opacity-50 ${toneClass}`}
    >
      <Icon icon={icon} className="w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  );
};
