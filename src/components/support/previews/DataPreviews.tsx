"use client";

import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { cn } from "../../../lib/utils";
import { SearchWithFilters } from "../../ui/SearchWithFilters";
import { Badge, type BadgeTone, InfoGrid, MonoBlock } from "./common";
import {
  formatMb,
  itemData,
  javaText,
  joinParts,
  loaderText,
  num,
  parseModList,
  previewText,
  str,
} from "./parse";
import type { SupportPreviewProps } from "./types";

export function RawPreview({ item }: SupportPreviewProps) {
  const { t } = useTranslation();
  const data = itemData(item);
  const text = data ? JSON.stringify(data, null, 2) : previewText(item);
  return <MonoBlock text={text || t("support_request.preview.empty")} />;
}

const SOURCE_TONES: Record<string, BadgeTone> = {
  pack: "info",
  modrinth: "good",
  curseforge: "warn",
  local: "neutral",
};

export function ModListPreview(props: SupportPreviewProps) {
  const { t } = useTranslation();
  const mods = useMemo(() => parseModList(props.item), [props.item]);
  const [query, setQuery] = useState("");

  if (!mods) return <RawPreview {...props} />;

  const q = query.trim().toLowerCase();
  const shown = q ? mods.filter((m) => m.name.toLowerCase().includes(q)) : mods;

  return (
    <div className="space-y-2">
      <p className="font-minecraft text-base text-white tracking-wide">
        {t("support_request.preview.mods.header", { count: mods.length })}
      </p>
      <SearchWithFilters
        placeholder={t("support_request.preview.mods.search")}
        searchValue={query}
        onSearchChange={setQuery}
        showSort={false}
        showFilter={false}
        compact
      />
      <div className="space-y-1">
        {shown.map((m, i) => (
          <div
            key={`${m.name}-${i}`}
            className={cn(
              "flex items-center gap-2 rounded border border-white/10 bg-black/20 px-2 py-1",
              !m.enabled && "opacity-50",
            )}
          >
            <Icon icon="solar:box-bold" className="w-4 h-4 shrink-0 text-white/60" />
            <span className="min-w-0 flex-1 truncate font-minecraft text-sm text-white tracking-wide">{m.name}</span>
            {m.version && <span className="font-mono text-xs text-white/50 truncate max-w-[30%]">{m.version}</span>}
            {m.source && <Badge tone={SOURCE_TONES[m.source.toLowerCase()] ?? "neutral"}>{m.source}</Badge>}
            {!m.enabled && <Badge>{t("support_request.preview.mods.off")}</Badge>}
          </div>
        ))}
        {shown.length === 0 && (
          <p className="font-minecraft text-sm text-white/50 tracking-wide">{t("support_request.preview.mods.no_match")}</p>
        )}
      </div>
    </div>
  );
}

export function ProfileSummaryPreview(props: SupportPreviewProps) {
  const { t } = useTranslation();
  const d = itemData(props.item);
  if (!d) return <RawPreview {...props} />;
  const label = (key: string) => t(`support_request.preview.profile.${key}`);
  return (
    <InfoGrid
      fields={[
        ["solar:user-id-bold", label("name"), str(d.profileName)],
        ["solar:gamepad-bold", label("minecraft"), str(d.minecraftVersion)],
        ["solar:layers-bold", label("loader"), loaderText(d)],
        ["solar:widget-4-bold", label("pack"), str(d.noriskPack)],
        ["solar:box-bold", label("mods"), num(d.modCount)?.toString() ?? null],
        ["solar:server-square-bold", label("memory"), formatMb(num(d.memoryMaxMb))],
        ["solar:code-bold", label("java"), javaText(d)],
      ]}
    />
  );
}

export function SystemInfoPreview(props: SupportPreviewProps) {
  const { t } = useTranslation();
  const d = itemData(props.item);
  if (!d) return <RawPreview {...props} />;
  const label = (key: string) => t(`support_request.preview.system.${key}`);
  const cores = num(d.cpuCores);
  const cpu = str(d.cpu) ? `${str(d.cpu)}${cores ? ` (${t("support_request.preview.system.cores", { count: cores })})` : ""}` : null;
  return (
    <InfoGrid
      fields={[
        ["solar:monitor-bold", label("os"), joinParts([str(d.os), str(d.osVersion), str(d.arch)])],
        ["solar:cpu-bolt-bold", label("cpu"), cpu],
        ["solar:server-square-bold", label("memory"), formatMb(num(d.memoryTotalMb))],
        ["solar:code-bold", label("java"), javaText(d)],
        ["solar:global-bold", label("locale"), str(d.locale)],
      ]}
    />
  );
}

