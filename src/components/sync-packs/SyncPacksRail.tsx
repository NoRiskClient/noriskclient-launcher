import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Button } from "../ui/buttons/Button";
import { PLAIN_TEXT } from "../ui/typography";
import { useThemeStore } from "../../store/useThemeStore";
import { openExternalUrl } from "../../services/tauri-service";
import type { SyncPack } from "../../types/syncPacks";

const STEPS = ["syncPacks.rail.step.create", "syncPacks.rail.step.fill", "syncPacks.rail.step.sync"];

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
    <div className="flex flex-col gap-4 px-1 pt-1 font-minecraft normal-case select-none">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-lg text-white">{t("syncPacks.title")}</span>
          <span className="text-[10px] uppercase tracking-wider" style={{ color: accent }}>
            {t("syncPacks.betaTag")}
          </span>
          <button
            type="button"
            title={t("syncPacks.rail.feedback")}
            onClick={() => void openExternalUrl(feedbackUrl).catch(() => {})}
            className="ml-auto text-white/35 hover:text-white transition-colors"
          >
            <Icon icon="ic:baseline-discord" className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-white/55 leading-relaxed">{t("syncPacks.description")}</p>
      </div>

      <div className="flex border-y border-white/10 py-3">
        {stats.map((stat) => (
          <div key={stat.label} className="flex-1 text-center">
            <div className="text-xl text-white tabular-nums leading-none">{stat.value}</div>
            <div className="mt-1 text-[11px] text-white/40">{stat.label}</div>
          </div>
        ))}
      </div>

      <ol className="space-y-2">
        {STEPS.map((key, index) => (
          <li key={key} className="flex gap-2.5 text-xs leading-snug text-white/65">
            <span className="shrink-0 tabular-nums" style={{ color: accent }}>
              {index + 1}
            </span>
            {t(key)}
          </li>
        ))}
      </ol>

      <Button
        variant="success"
        className={`w-full ${PLAIN_TEXT}`}
        icon={<Icon icon="solar:add-circle-bold" className="w-4 h-4" />}
        onClick={onCreate}
        disabled={createDisabled}
      >
        {t("syncPacks.create")}
      </Button>
    </div>
  );
}
