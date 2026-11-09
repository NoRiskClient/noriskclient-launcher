"use client";

import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Icon } from "@iconify/react";
import { ProfileIconV2 } from "../../../ProfileIconV2";
import type { Profile } from "../../../../../types/profile";
import type { CopyContentItem, CopyContentsResult } from "../../../../../types/content";

export interface CopyContentEntry extends CopyContentItem {
  iconUrl: string | null;
  disabled: boolean;
}

export interface TargetOutcome {
  profile: Profile;
  result: CopyContentsResult | null;
}

type Status = "copied" | "alreadyThere" | "incompatible" | "failed";

const STATUS_STYLE: Record<Status, { icon: string; className: string }> = {
  copied: { icon: "solar:check-circle-bold", className: "text-emerald-400" },
  alreadyThere: { icon: "solar:check-read-linear", className: "text-white/40" },
  incompatible: { icon: "solar:danger-triangle-bold", className: "text-amber-400" },
  failed: { icon: "solar:close-circle-bold", className: "text-red-400" },
};

function summaryParts(t: TFunction, result: CopyContentsResult): string {
  return [
    result.copied.length > 0 && t("profiles.v3.copy.copied", { count: result.copied.length }),
    result.already_there.length > 0 && t("profiles.v3.copy.alreadyThere", { count: result.already_there.length }),
    result.incompatible.length > 0 && t("profiles.v3.copy.incompatible", { count: result.incompatible.length }),
    result.failed.length > 0 && t("profiles.v3.copy.failed", { count: result.failed.length }),
  ]
    .filter(Boolean)
    .join(", ");
}

function statusOf(result: CopyContentsResult, name: string): Status {
  if (result.incompatible.includes(name)) return "incompatible";
  if (result.failed.includes(name)) return "failed";
  if (result.already_there.includes(name)) return "alreadyThere";
  return "copied";
}

const STATUS_ORDER: Status[] = ["incompatible", "failed", "copied", "alreadyThere"];

export function ItemIcon({ iconUrl, size }: { iconUrl: string | null; size: "sm" | "md" }) {
  const box = size === "sm" ? "w-5 h-5" : "w-7 h-7";
  return (
    <div className={`${box} flex-shrink-0 rounded-sm bg-white/5 flex items-center justify-center overflow-hidden`}>
      {iconUrl ? (
        <img src={iconUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <Icon icon="solar:bolt-bold-duotone" className="w-3.5 h-3.5 text-white/50" />
      )}
    </div>
  );
}

export function CopyResultList({ outcomes, items }: { outcomes: TargetOutcome[]; items: CopyContentEntry[] }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      {outcomes.map((outcome) => {
        const { profile, result } = outcome;
        const rows = result
          ? items
              .map((item) => ({ item, status: statusOf(result, item.name) }))
              .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
          : [];
        return (
          <section key={profile.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <ProfileIconV2 profile={profile} size="sm" />
              <div className="min-w-0">
                <div className="text-sm text-white font-minecraft normal-case truncate">{profile.name}</div>
                <div className={`text-xs font-minecraft normal-case ${result ? "text-white/50" : "text-red-400"}`}>
                  {result ? summaryParts(t, result) : t("profiles.v3.copy.status.failed")}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {rows.map(({ item, status }) => (
                <div key={item.path} className="flex items-center gap-2 rounded-md bg-black/20 border border-white/10 px-2 py-1.5">
                  <ItemIcon iconUrl={item.iconUrl} size="sm" />
                  <span className="flex-1 min-w-0 text-sm text-white font-minecraft normal-case truncate">{item.name}</span>
                  <span className={`flex items-center gap-1.5 text-xs font-minecraft normal-case ${STATUS_STYLE[status].className}`}>
                    <Icon icon={STATUS_STYLE[status].icon} className="w-4 h-4" />
                    {t(`profiles.v3.copy.status.${status}`)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
