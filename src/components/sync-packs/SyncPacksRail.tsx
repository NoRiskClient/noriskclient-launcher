import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Button } from "../ui/buttons/Button";
import { PLAIN_TEXT } from "../ui/typography";
import { useThemeStore } from "../../store/useThemeStore";
import { openExternalUrl } from "../../services/tauri-service";
import type { SyncPack } from "../../types/syncPacks";

const STEPS = [
  { icon: "solar:folder-with-files-bold", key: "syncPacks.rail.step.create" },
  { icon: "solar:widget-add-bold", key: "syncPacks.rail.step.fill" },
  { icon: "solar:refresh-circle-bold", key: "syncPacks.rail.step.sync" },
];

interface SyncPacksRailProps {
  packs: SyncPack[];
  onCreate: () => void;
  createDisabled: boolean;
  feedbackUrl: string;
}

export function SyncPacksRail({ packs, onCreate, createDisabled, feedbackUrl }: SyncPacksRailProps) {
  const { t } = useTranslation();
  const accent = useThemeStore((state) => state.accentColor.value);
  const stats = [
    { value: packs.filter((pack) => pack.enabled).length, label: t("syncPacks.rail.stats.active") },
    { value: packs.reduce((sum, pack) => sum + pack.mods.length, 0), label: t("syncPacks.rail.stats.mods") },
    { value: packs.reduce((sum, pack) => sum + pack.targets.length, 0), label: t("syncPacks.rail.stats.targets") },
  ];

  return (
    <div className="flex flex-col gap-3 font-minecraft normal-case select-none">
      <div className="rounded-lg bg-white/[0.04] p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Icon icon="solar:refresh-circle-bold" className="w-6 h-6 shrink-0" style={{ color: accent }} />
          <span className="text-base text-white">{t("syncPacks.title")}</span>
          <span
            className="ml-auto rounded px-1.5 text-[10px] uppercase tracking-wider border"
            style={{ color: accent, borderColor: `${accent}66`, backgroundColor: `${accent}1a` }}
          >
            {t("syncPacks.betaTag")}
          </span>
        </div>
        <p className="text-xs text-white/55 leading-relaxed">{t("syncPacks.description")}</p>
      </div>

      <Button
        variant="success"
        className={`w-full ${PLAIN_TEXT}`}
        icon={<Icon icon="solar:add-circle-bold" className="w-4 h-4" />}
        onClick={onCreate}
        disabled={createDisabled}
      >
        {t("syncPacks.create")}
      </Button>

      <div className="grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg bg-white/[0.04] px-2 py-2.5 text-center">
            <div className="text-xl text-white tabular-nums leading-none">{stat.value}</div>
            <div className="mt-1 text-[11px] text-white/45 truncate">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-white/[0.04] p-3 space-y-2">
        <div className="text-xs text-white/45">{t("syncPacks.rail.howTitle")}</div>
        {STEPS.map((step, index) => (
          <div key={step.key} className="flex items-start gap-3">
            <span
              className="w-6 h-6 shrink-0 rounded-md flex items-center justify-center"
              style={{ backgroundColor: `${accent}22`, color: accent }}
            >
              <Icon icon={step.icon} className="w-3.5 h-3.5" />
            </span>
            <p className="text-xs text-white/70 leading-snug pt-0.5">
              <span className="text-white/35 mr-1">{index + 1}.</span>
              {t(step.key)}
            </p>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void openExternalUrl(feedbackUrl).catch(() => {})}
        className="flex items-center justify-center gap-1.5 text-xs text-white/45 hover:text-white transition-colors"
      >
        <Icon icon="ic:baseline-discord" className="w-4 h-4" />
        {t("syncPacks.rail.feedback")}
      </button>
    </div>
  );
}
