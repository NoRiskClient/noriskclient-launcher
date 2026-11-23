import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { AccentButton } from "../ui/AccentButton";
import { useThemeStore } from "../../store/useThemeStore";
import { RailIntro } from "../ads/RailIntro";

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
      <RailIntro
        title={t("syncPacks.title")}
        tag={t("syncPacks.betaTag")}
        description={t("syncPacks.description")}
        feedbackUrl={feedbackUrl}
        feedbackLabel={t("syncPacks.rail.feedback")}
      />

      <div className="space-y-2.5">
        <div className="text-xs text-white/40">{t("syncPacks.rail.useTitle")}</div>
        {USES.map((use) => (
          <div key={use.key} className="flex items-start gap-2.5 text-xs leading-snug text-white/70">
            <Icon icon={use.icon} className="w-4 h-4 shrink-0" style={{ color: accent }} />
            {t(use.key)}
          </div>
        ))}
      </div>

      <AccentButton icon="solar:add-circle-bold" onClick={onCreate} disabled={createDisabled}>
        {t("syncPacks.create")}
      </AccentButton>
    </div>
  );
}
