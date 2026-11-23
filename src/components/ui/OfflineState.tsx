import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../store/useThemeStore";

interface OfflineStateProps {
  onRetry: () => void;
  title?: string;
  description?: string;
}

export function OfflineState({ onRetry, title, description }: OfflineStateProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor.value);

  return (
    <div className="col-span-full py-12 px-6 text-center">
      <div
        className="w-16 h-16 mx-auto mb-4 rounded-xl flex items-center justify-center"
        style={{ backgroundColor: `${accentColor}15`, border: `1px solid ${accentColor}40` }}
      >
        <Icon icon="solar:wi-fi-router-minimalistic-bold" className="w-8 h-8" style={{ color: accentColor }} />
      </div>
      <p className="text-white/50 text-xs font-minecraft">{title ?? t("common.offline_title")}</p>
      <p className="text-white/30 text-sm mt-1 font-smallcaps">{description ?? t("common.offline_desc")}</p>
      <button
        onClick={onRetry}
        className="mt-4 px-4 py-2 rounded-lg font-smallcaps text-sm text-white"
        style={{ backgroundColor: `${accentColor}30`, border: `1px solid ${accentColor}60` }}
      >
        {t("common.retry")}
      </button>
    </div>
  );
}
