import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import {
  getLauncherNotices,
  type LauncherNotice,
  type LauncherNoticeSeverity,
} from "../../services/flagsmith-service";
import { openExternalUrl } from "../../services/tauri-service";
import { useThemeStore } from "../../store/useThemeStore";
import { BannerCard } from "./BannerCard";

const SEVERITY_COLORS: Record<LauncherNoticeSeverity, string> = {
  info: "#3b82f6",
  warning: "#f59e0b",
  error: "#ef4444",
};

const SEVERITY_ICONS: Record<LauncherNoticeSeverity, string> = {
  info: "solar:info-circle-bold",
  warning: "solar:danger-triangle-bold",
  error: "solar:close-circle-bold",
};

export function LauncherNoticeBanner() {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const [notices, setNotices] = useState<LauncherNotice[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    getLauncherNotices()
      .then(setNotices)
      .catch(() => setNotices([]));
  }, []);

  const dismiss = (id: string) =>
    setDismissed((prev) => (prev.includes(id) ? prev : [...prev, id]));

  const visible = notices.filter((n) => !dismissed.includes(n.id));
  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 max-w-[calc(100vw-2rem)] flex flex-col gap-3">
      {visible.map((notice) => {
        const severity: LauncherNoticeSeverity = notice.severity ?? "warning";
        const color =
          severity === "info" ? accentColor.value : SEVERITY_COLORS[severity];

        return (
          <BannerCard
            key={notice.id}
            color={color}
            onDismiss={() => dismiss(notice.id)}
            dismissTitle={t("common.close_banner")}
          >
            <div className="flex items-start gap-3 pr-8">
              <Icon
                icon={SEVERITY_ICONS[severity]}
                className="w-6 h-6 flex-shrink-0 mt-1"
                style={{ color }}
              />

              <div className="flex-1 min-w-0">
                {notice.title && (
                  <h3 className="text-2xl font-minecraft text-white mb-2 lowercase">
                    {notice.title}
                  </h3>
                )}

                <p className="text-sm text-gray-300 font-minecraft-ten leading-relaxed">
                  {notice.message}
                </p>

                {notice.link_url && (
                  <button
                    onClick={() => openExternalUrl(notice.link_url!)}
                    className="mt-3 inline-flex items-center gap-1.5 font-minecraft text-lg lowercase transition-colors hover:underline underline-offset-2"
                    style={{ color }}
                  >
                    <Icon icon="solar:arrow-right-up-linear" className="w-4 h-4" />
                    {notice.link_label || notice.link_url}
                  </button>
                )}
              </div>
            </div>
          </BannerCard>
        );
      })}
    </div>
  );
}
