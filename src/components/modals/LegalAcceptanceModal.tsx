import { useState } from "react";
import { useTranslation } from "react-i18next";
import { exit } from "@tauri-apps/plugin-process";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { openExternalUrl } from "../../services/tauri-service";
import { useThemeStore } from "../../store/useThemeStore";
import { formatLegalDate, legalDocumentUrl, legalLocale } from "../../config/legal";
import { useLegalStore } from "../../store/legal-store";
import type { PendingLegalDocument } from "../../services/legal-service";

export function LegalAcceptanceModal() {
  const { t, i18n } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const prompt = useLegalStore((s) => s.prompt);
  const acknowledge = useLegalStore((s) => s.acknowledge);
  const [saving, setSaving] = useState(false);

  if (!prompt) return null;

  const { firstTime, documents } = prompt;

  const handleAccept = async () => {
    setSaving(true);
    try {
      await acknowledge();
    } catch (error) {
      console.error("[LegalAcceptanceModal] Failed to save acceptance:", error);
      toast.error(t("legal.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  const renderDocument = (doc: PendingLegalDocument) => {
    const url = legalDocumentUrl(doc.slug, legalLocale(doc.locale));
    const consent = doc.kind === "consent";
    const date = formatLegalDate(doc.updatedAt, i18n.language);
    return (
      <button
        key={`${doc.slug}:${doc.locale}`}
        onClick={() => url && openExternalUrl(url)}
        className="group w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
        style={{ borderColor: `${accentColor.value}26` }}
      >
        <Icon icon="solar:document-text-linear" className="w-5 h-5 mt-0.5 text-white/50 flex-shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block font-minecraft text-white">{doc.title}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5 text-xs font-minecraft text-white/40">
            {consent && (
              <span
                className="px-1.5 py-px rounded border text-[10px] whitespace-nowrap"
                style={{ color: accentColor.value, borderColor: `${accentColor.value}80` }}
              >
                {t("legal.consent_required")}
              </span>
            )}
            <span className="whitespace-nowrap">{t(firstTime ? "legal.as_of" : "legal.updated_on", { date })}</span>
          </span>
          {!firstTime && doc.changeSummary && (
            <span
              className="block mt-2 pl-3 border-l-2 text-sm font-minecraft text-white/70 leading-relaxed whitespace-pre-line"
              style={{ borderColor: `${accentColor.value}60` }}
            >
              {doc.changeSummary}
            </span>
          )}
        </span>
        <span className="self-center flex items-center gap-1 text-xs font-minecraft text-white/40 group-hover:text-white transition-colors">
          {t("legal.open")}
          <Icon icon="solar:arrow-right-up-linear" className="w-3.5 h-3.5" />
        </span>
      </button>
    );
  };

  const footer = (
    <div className="flex items-center justify-end gap-3">
      <Button onClick={() => exit(0)} variant="ghost" size="sm">
        {t("legal.decline")}
      </Button>
      <Button onClick={handleAccept} variant="default" disabled={saving}>
        {t("legal.accept")}
      </Button>
    </div>
  );

  return (
    <Modal
      title={t(firstTime ? "legal.title" : "legal.title_updated")}
      titleIcon={
        <Icon
          icon={firstTime ? "solar:shield-check-bold" : "solar:bell-bold"}
          className="w-6 h-6"
          style={{ color: accentColor.value }}
        />
      }
      onClose={() => {}}
      width="md"
      footer={footer}
      closeOnClickOutside={false}
      hideCloseButton
    >
      <div className="px-6 pt-5 pb-2 space-y-4">
        <p className="text-sm font-minecraft text-white/70 leading-relaxed">
          {firstTime ? t("legal.first_time") : t("legal.updated", { count: documents.length })}
        </p>
        <div
          className="rounded-md border divide-y overflow-hidden"
          style={{ borderColor: `${accentColor.value}40`, backgroundColor: `${accentColor.value}0d` }}
        >
          {documents.map(renderDocument)}
        </div>
      </div>
    </Modal>
  );
}
