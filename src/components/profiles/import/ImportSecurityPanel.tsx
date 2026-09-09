"use client";

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

import type {
  ExecutableContentReport,
  ImportSecurityReport,
  ProvenanceReport,
} from "../../../types/importPreview";

export function truncateEntry(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export interface ImportSecurityPanelProps {
  security: ImportSecurityReport;
  provenance: ProvenanceReport;
  executableContent: ExecutableContentReport;
}

export function hasProvenanceFindings({
  security,
  provenance,
  executableContent,
}: ImportSecurityPanelProps): boolean {
  return (
    provenance.unknown.length > 0 ||
    security.thirdPartyDownloadHosts.length > 0 ||
    executableContent.scripts.length > 0 ||
    executableContent.natives.length > 0
  );
}

function FileList({ paths }: { paths: string[] }) {
  return (
    <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto custom-scrollbar pr-1">
      {paths.map((path, index) => (
        <li
          key={`${path}-${index}`}
          className="text-sm text-white/70 font-minecraft tracking-wide break-all"
        >
          {truncateEntry(path)}
        </li>
      ))}
    </ul>
  );
}

export function ImportTrustWarning() {
  const { t } = useTranslation();

  return (
    <div className="flex items-start gap-3 rounded-md border-2 border-yellow-500/40 bg-yellow-500/10 p-3">
      <Icon
        icon="solar:shield-warning-bold"
        className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5"
      />
      <p className="text-base text-white/85 font-minecraft tracking-wide">
        {t("profiles.import.trust_warning")}
      </p>
    </div>
  );
}

export function ImportSecurityPanel(props: ImportSecurityPanelProps) {
  const { t } = useTranslation();

  if (!hasProvenanceFindings(props)) return null;

  const { unknown, verifiedCount, incomplete } = props.provenance;
  const hosts = props.security.thirdPartyDownloadHosts;
  const { scripts, natives, scriptCount, nativeCount } = props.executableContent;

  return (
    <div className="rounded-md border-2 border-orange-500/40 bg-orange-500/10 p-3 space-y-4">
      {natives.length > 0 && (
        <div className="flex items-start gap-3">
          <Icon
            icon="solar:danger-triangle-bold"
            className="w-5 h-5 text-orange-300 shrink-0 mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-base text-white/85 font-minecraft tracking-wide">
              {t("profiles.import.natives_heading", { count: nativeCount })}
            </p>
            <p className="text-sm text-white/55 font-minecraft tracking-wide mt-1">
              {t("profiles.import.natives_explainer")}
            </p>
            <FileList paths={natives} />
          </div>
        </div>
      )}

      {scripts.length > 0 && (
        <div className="flex items-start gap-3">
          <Icon
            icon="solar:code-bold"
            className="w-5 h-5 text-orange-300 shrink-0 mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-base text-white/85 font-minecraft tracking-wide">
              {t("profiles.import.scripts_heading", { count: scriptCount })}
            </p>
            <p className="text-sm text-white/55 font-minecraft tracking-wide mt-1">
              {t("profiles.import.scripts_explainer")}
            </p>
            <FileList paths={scripts} />
          </div>
        </div>
      )}

      {hosts.length > 0 && (
        <div className="flex items-start gap-3">
          <Icon
            icon="solar:global-bold"
            className="w-5 h-5 text-orange-300 shrink-0 mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-base text-white/85 font-minecraft tracking-wide">
              {t("profiles.import.hosts_heading", { count: hosts.length })}
            </p>
            <p className="text-sm text-white/55 font-minecraft tracking-wide mt-1">
              {t("profiles.import.hosts_explainer")}
            </p>
            <FileList paths={hosts} />
          </div>
        </div>
      )}

      {unknown.length > 0 && (
        <div className="flex items-start gap-3">
          <Icon
            icon="solar:question-circle-bold"
            className="w-5 h-5 text-orange-300 shrink-0 mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-base text-white/85 font-minecraft tracking-wide">
              {t("profiles.import.unknown_heading", { count: unknown.length })}
            </p>
            <p className="text-sm text-white/55 font-minecraft tracking-wide mt-1">
              {incomplete
                ? t("profiles.import.unknown_lookup_failed")
                : t("profiles.import.unknown_explainer", { count: verifiedCount })}
            </p>
            <ul className="mt-2 space-y-1 max-h-52 overflow-y-auto custom-scrollbar pr-1">
              {unknown.map((entry, index) => (
                <li
                  key={`${entry.name}-${index}`}
                  className="text-sm text-white/70 font-minecraft tracking-wide break-all"
                >
                  {truncateEntry(entry.name)}
                  <span className="text-white/35">
                    {" - "}
                    {t(`profiles.import.unknown_reason_${entry.reason}`)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
