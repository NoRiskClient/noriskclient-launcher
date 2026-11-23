import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Button } from "../ui/buttons/Button";
import { PLAIN_TEXT } from "../ui/typography";
import { useThemeStore } from "../../store/useThemeStore";
import { openExternalUrl } from "../../services/tauri-service";

const USES = [
  { icon: "solar:earth-bold", key: "syncPacks.rail.use.worlds" },
  { icon: "solar:settings-bold", key: "syncPacks.rail.use.settings" },
  { icon: "solar:server-bold", key: "syncPacks.rail.use.servers" },
  { icon: "solar:bolt-bold", key: "syncPacks.rail.use.mods" },
];

interface SyncPacksRailProps {
  onCreate: () => void;
  createDisabled: boolean;
  feedbackUrl: string;
}

export function SyncPacksRail({ onCreate, createDisabled, feedbackUrl }: SyncPacksRailProps) {
  const { t } = useTranslation();
  const accent = useThemeStore((state) => state.accentColor.value);

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

      <div className="space-y-2.5">
        <div className="text-xs text-white/40">{t("syncPacks.rail.useTitle")}</div>
        {USES.map((use) => (
          <div key={use.key} className="flex items-start gap-2.5 text-xs leading-snug text-white/70">
            <Icon icon={use.icon} className="w-4 h-4 shrink-0" style={{ color: accent }} />
            {t(use.key)}
          </div>
        ))}
      </div>

      <Button
        variant="default"
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
