import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { exit } from "@tauri-apps/plugin-process";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { openExternalUrl } from "../../services/tauri-service";
import { useThemeStore } from "../../store/useThemeStore";

const LEGAL_UPDATES_URL = "https://api.norisk.gg/api/v1/payback/legal/updates";

/** The documents a user has to accept, and where to read them. */
export const DOCUMENT_URLS: Record<string, { de: string; en: string }> = {
  terms: { en: "https://norisk.gg/tos", de: "https://norisk.gg/de/agbs" },
  privacy: { en: "https://norisk.gg/privacy", de: "https://norisk.gg/de/datenschutzerklaerung" },
  licenses: { en: "https://norisk.gg/licenses", de: "https://norisk.gg/de/lizenzen" },
};

interface LegalDocument {
  slug: string;
  locale: string;
  title: string;
  version: number;
  requiresAcknowledgement: boolean;
}

type Accepted = Record<string, number>;

const keyOf = (doc: LegalDocument) => `${doc.slug}:${doc.locale}`;

export function LegalAcceptanceModal() {
  const { t, i18n } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const [accepted, setAccepted] = useState<Accepted | null>(null);
  const [documents, setDocuments] = useState<LegalDocument[]>([]);

  useEffect(() => {
    Promise.all([
      invoke<Accepted>("get_legal_acceptance").catch(() => ({})),
      // Unreachable backend: skip the prompt rather than lock the launcher.
      fetch(LEGAL_UPDATES_URL).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([acc, docs]) => {
      setDocuments(docs);
      setAccepted(acc);
    });
  }, []);

  const lang = i18n.language?.startsWith("de") ? "de" : "en";
  const firstTime = accepted !== null && Object.keys(accepted).length === 0;
  const current = documents.filter((doc) => doc.locale === lang && doc.slug in DOCUMENT_URLS);
  const outdated = accepted === null
    ? []
    : current.filter((doc) =>
        firstTime || (doc.requiresAcknowledgement && (accepted[keyOf(doc)] ?? 0) < doc.version));

  if (accepted === null || outdated.length === 0) return null;

  const handleAccept = async () => {
    const required = documents.filter((doc) => doc.slug in DOCUMENT_URLS);
    const versions = { ...accepted, ...Object.fromEntries(required.map((doc) => [keyOf(doc), doc.version])) };
    try {
      await invoke("set_legal_acceptance", { versions });
      setAccepted(versions);
    } catch {
      toast.error(t("legal.save_failed"));
    }
  };

  const footer = (
    <div className="flex items-center justify-end gap-3">
      <Button onClick={() => exit(0)} variant="ghost" size="sm">
        {t("legal.decline")}
      </Button>
      <Button onClick={handleAccept} variant="default">
        {t("legal.accept")}
      </Button>
    </div>
  );

  return (
    <Modal
      title={t(firstTime ? "legal.title" : "legal.title_updated")}
      titleIcon={<Icon icon="solar:shield-check-bold" className="w-6 h-6" style={{ color: accentColor.value }} />}
      onClose={() => {}}
      width="md"
      footer={footer}
      closeOnClickOutside={false}
      hideCloseButton
    >
      <div className="px-6 pt-5 pb-2 space-y-4">
        <p className="text-sm font-minecraft text-white/70 leading-relaxed">
          {firstTime ? t("legal.first_time") : t("legal.updated", { count: outdated.length })}
        </p>
        <div
          className="rounded-md border divide-y overflow-hidden"
          style={{ borderColor: `${accentColor.value}40`, backgroundColor: `${accentColor.value}0d` }}
        >
          {outdated.map((doc) => (
            <button
              key={keyOf(doc)}
              onClick={() => openExternalUrl(DOCUMENT_URLS[doc.slug][lang])}
              className="group w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
              style={{ borderColor: `${accentColor.value}26` }}
            >
              <Icon icon="solar:document-text-linear" className="w-5 h-5 text-white/50 flex-shrink-0" />
              <span className="flex-1 font-minecraft text-white">{doc.title}</span>
              <span className="flex items-center gap-1 text-xs font-minecraft text-white/40 group-hover:text-white transition-colors">
                {t("legal.open")}
                <Icon icon="solar:arrow-right-up-linear" className="w-3.5 h-3.5" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
