import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { useLauncherAdsStore } from "../../store/launcher-ads-store";
import { AdSlot } from "./AdSlot";

export const MAIN_AD_SLOT = "play-news";

export function useMainAdAvailable() {
  const active = useLauncherAdsStore((state) => state.active);
  const size = useLauncherAdsStore((state) => state.slots[MAIN_AD_SLOT]);
  return active && !!size;
}

export function AdCard({ className }: { className?: string }) {
  const { t } = useTranslation();
  const openConsent = useLauncherAdsStore((state) => state.openConsent);

  return (
    <div className={cn("w-full flex flex-col", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-smallcaps text-base text-white/70 truncate">{t("ads.label")}</p>
        <button
          type="button"
          onClick={openConsent}
          className="shrink-0 font-minecraft text-xs text-white/40 hover:text-white/80 transition-colors"
        >
          {t("ads.privacy_link")}
        </button>
      </div>
      <div className="w-full flex justify-center rounded-lg border-2 border-white/10 bg-black/30 overflow-hidden">
        <AdSlot slot={MAIN_AD_SLOT} />
      </div>
    </div>
  );
}
