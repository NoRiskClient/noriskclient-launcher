"use client";

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Bullets } from "./common";
import { loaderName } from "./parse";
import type { SupportPreviewProps } from "./types";

function ChangeCard({
  ctx,
  icon,
  title,
  from,
  to,
  note,
}: Pick<SupportPreviewProps, "ctx"> & {
  icon: string;
  title: string;
  from?: string | null;
  to?: string | null;
  note: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="rounded-lg border-2 border-white/15 bg-black/20 p-4 space-y-2">
        <div className="flex items-center gap-3">
          <Icon icon={icon} className="w-9 h-9 shrink-0 text-amber-300" />
          <div className="min-w-0">
            <p className="font-minecraft text-lg text-white tracking-wide">{title}</p>
            {ctx.profile && (
              <p className="font-minecraft text-sm text-white/60 tracking-wide">
                {t("support_request.preview.action.profile", { profile: ctx.profile.name })}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 py-1">
          <span className="rounded-md bg-black/40 border border-white/10 px-3 py-1 font-mono text-lg text-white/60 break-all">
            {from || "?"}
          </span>
          <Icon icon="solar:alt-arrow-right-linear" className="w-6 h-6 text-white/60" />
          <span className="rounded-md bg-green-500/15 border border-green-500/40 px-3 py-1 font-mono text-lg text-green-200 break-all">
            {to || "?"}
          </span>
        </div>
      </div>
      <Bullets items={[t("support_request.preview.action.only_this_profile"), note]} />
    </div>
  );
}

export function LoaderUpdatePreview({ item, ctx }: SupportPreviewProps) {
  const { t } = useTranslation();
  const loader = loaderName(ctx.profile?.loader) || t("support_request.preview.action.loader_fallback");
  return (
    <ChangeCard
      ctx={ctx}
      icon="solar:refresh-circle-bold"
      title={t("support_request.preview.action.loader_title", { loader })}
      from={item.action?.from}
      to={item.action?.to}
      note={t("support_request.preview.action.worlds_mods_stay")}
    />
  );
}

export function SwitchPackPreview({ item, ctx }: SupportPreviewProps) {
  const { t } = useTranslation();
  return (
    <ChangeCard
      ctx={ctx}
      icon="solar:widget-4-bold"
      title={t("support_request.preview.action.pack_title")}
      from={item.action?.fromName || item.action?.from}
      to={item.action?.toName || item.action?.to}
      note={t("support_request.preview.action.switch_back")}
    />
  );
}
