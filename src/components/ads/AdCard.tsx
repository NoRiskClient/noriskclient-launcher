import { useTranslation } from "react-i18next";
import { useLauncherAdsStore } from "../../store/launcher-ads-store";
import type { AdSize } from "../../services/ads-service";
import { AdSlot } from "./AdSlot";
import { AdFallback } from "./AdFallback";
import { useOpenAdPause } from "./AdPauseDialog";

export const MAIN_AD_SLOT = "play-news";
/** Friends window rail; the ad view moves there while that window is in front. */
export const FRIENDS_AD_SLOT = "friends-rail";

export function useAdSize(slot: string): AdSize | null {
  const active = useLauncherAdsStore((state) => state.active);
  const size = useLauncherAdsStore((state) => state.slots[slot]);
  const paused = useLauncherAdsStore((state) => state.pausedUntil !== null);
  return active && size && !paused ? size : null;
}

export function AdCaption() {
  const { t } = useTranslation();
  const openPause = useOpenAdPause("rail");
  return (
    <div className="flex items-center justify-between gap-2 px-0.5 font-minecraft text-[10px] uppercase tracking-wider text-white/35">
      <span>{t("ads.label")}</span>
      <button
        type="button"
        onClick={openPause}
        className="truncate uppercase tracking-wider text-white/50 hover:text-white transition-colors"
      >
        {t("ads.disable")}
      </button>
    </div>
  );
}

export function AdFrame({ slot, size }: { slot: string; size: AdSize }) {
  return (
    <div
      className="relative shrink-0 rounded-md overflow-hidden bg-black/40 ring-1 ring-white/10"
      style={{ width: size.width, height: size.height }}
    >
      <AdFallback />
      <AdSlot slot={slot} className="relative" />
    </div>
  );
}
