"use client";

import { useMemo } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

import type { ImportSecurityReport } from "../../../types/importPreview";
import { truncateEntry } from "./ImportSecurityPanel";

export function ImportRemovedList({ security }: { security: ImportSecurityReport }) {
  const { t } = useTranslation();

  const removed = useMemo(() => {
    const entries: string[] = [];

    if (security.strippedJavaPath) {
      entries.push(t("profiles.import.removed_java_path"));
    }
    if (security.strippedJvmArgs || security.strippedGameArgs.length > 0) {
      entries.push(t("profiles.import.removed_launch_args"));
    }
    for (const mod of security.rejectedMods) {
      entries.push(
        t("profiles.import.removed_mod", { name: truncateEntry(mod.displayName) }),
      );
    }
    for (const flag of security.strippedProfileFlags) {
      entries.push(t(`profiles.import.removed_flag_${flag}`));
    }

    return entries;
  }, [security, t]);

  if (removed.length === 0) return null;

  return (
    <div>
      <h3 className="text-base text-white font-smallcaps mb-2 select-none">
        {t("profiles.import.removed_heading")}
      </h3>
      <ul className="space-y-1.5 max-h-52 overflow-y-auto custom-scrollbar pr-1">
        {removed.map((entry, index) => (
          <li
            key={`${entry}-${index}`}
            className="flex items-start gap-2 text-base text-white/70 font-minecraft tracking-wide"
          >
            <Icon
              icon="solar:close-circle-bold"
              className="w-4 h-4 text-red-400 shrink-0 mt-1"
            />
            <span>{entry}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
