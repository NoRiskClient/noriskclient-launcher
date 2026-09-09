"use client";

import { useTranslation } from "react-i18next";

import { formatBytes } from "../../../utils/format-relative-time";
import { truncateEntry } from "./ImportSecurityPanel";

export interface ImportPreviewChipsProps {
  leadLabel: string;
  gameVersion?: string | null;
  loader?: string | null;
  modCount?: number | null;
  sizeBytes?: number | null;
}

export function buildPreviewChips(
  { leadLabel, gameVersion, loader, modCount, sizeBytes }: ImportPreviewChipsProps,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  return [
    truncateEntry(leadLabel, 44),
    [gameVersion, loader].filter(Boolean).join(" "),
    modCount == null ? "" : t("profiles.import.chip_mods", { count: modCount }),
    sizeBytes == null ? "" : formatBytes(sizeBytes),
  ]
    .filter(Boolean)
    .join("  ·  ");
}

export function ImportPreviewChips(props: ImportPreviewChipsProps) {
  const { t } = useTranslation();

  return (
    <span className="text-sm text-white/45 font-minecraft tracking-wide">
      {buildPreviewChips(props, t)}
    </span>
  );
}
