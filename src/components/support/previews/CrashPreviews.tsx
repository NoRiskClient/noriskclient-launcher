"use client";

import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { CrashCard } from "./common";
import { parseCrashReport, parseJvmCrash, previewText } from "./parse";
import type { SupportPreviewProps } from "./types";

export function CrashReportPreview({ item }: SupportPreviewProps) {
  const { t } = useTranslation();
  const text = previewText(item);
  const info = parseCrashReport(text);

  return (
    <CrashCard
      icon="solar:danger-triangle-bold"
      title={t("support_request.preview.crash.title")}
      detail={info.exception ?? info.description}
      text={text}
    >
      {info.suspectedMods.length > 0 && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 space-y-1">
          <p className="font-minecraft text-sm text-yellow-200 tracking-wide">{t("support_request.preview.crash.suspected")}</p>
          <ul className="space-y-0.5">
            {info.suspectedMods.map((m) => (
              <li key={m} className="font-mono text-xs text-white/85 break-all">
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}
    </CrashCard>
  );
}

export function JvmCrashPreview({ item }: SupportPreviewProps) {
  const { t } = useTranslation();
  const text = previewText(item);
  const info = parseJvmCrash(text);

  return (
    <CrashCard icon="solar:danger-circle-bold" title={t("support_request.preview.jvm.title")} detail={info.exception} text={text}>
      {info.culprit && (
        <div className="flex items-center gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2">
          <Icon icon="solar:info-circle-bold" className="w-5 h-5 shrink-0 text-sky-300" />
          <p className="font-minecraft text-sm text-white tracking-wide">
            {t(`support_request.preview.jvm.culprit_${info.culprit}`)}
          </p>
        </div>
      )}
    </CrashCard>
  );
}
