import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { BannerCard } from "../ui/BannerCard";
import { Button } from "../ui/buttons/Button";
import { openExternalUrl } from "../../services/tauri-service";
import { useLegalStore } from "../../store/legal-store";
import { formatLegalDate, legalDocumentUrl, legalLocale } from "../../config/legal";

export function LegalUpdateBanner() {
  const { t, i18n } = useTranslation();
  const notice = useLegalStore((s) => s.notice);
  const dismissNotice = useLegalStore((s) => s.dismissNotice);

  if (!notice) return null;

  const url = legalDocumentUrl(notice.slug, legalLocale(notice.locale));
  const dismiss = () => {
    dismissNotice().catch((error) => console.error("[LegalUpdateBanner] Failed to save dismissal:", error));
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 max-w-[calc(100vw-2rem)]">
      <BannerCard onDismiss={dismiss} dismissTitle={t("legal.notice.dismiss")}>
        <div className="flex items-start gap-3 pr-8">
          <Icon icon="solar:shield-check-bold" className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />

          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-smallcaps text-white leading-tight">
              {t("legal.notice.title", { title: notice.title })}
            </h3>
            <p className="mt-0.5 text-[11px] font-minecraft text-white/40">
              {t("legal.updated_on", { date: formatLegalDate(notice.updatedAt, i18n.language) })}
            </p>

            <p className="mt-2 mb-3 text-xs text-white/60 font-minecraft leading-snug whitespace-pre-line">
              {notice.changeSummary ?? t("legal.notice.description")}
            </p>

            <div className="flex items-center justify-end gap-2">
              {url && (
                <Button
                  onClick={() => openExternalUrl(url)}
                  variant="ghost"
                  size="sm"
                  className="px-3 py-1.5 text-gray-300 hover:text-white hover:bg-white/10 font-smallcaps text-xs"
                >
                  {t("legal.notice.view")}
                </Button>
              )}
              <Button
                onClick={dismiss}
                variant="default"
                size="sm"
                className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-black font-smallcaps text-xs"
              >
                {t("legal.notice.dismiss")}
              </Button>
            </div>
          </div>
        </div>
      </BannerCard>
    </div>
  );
}
