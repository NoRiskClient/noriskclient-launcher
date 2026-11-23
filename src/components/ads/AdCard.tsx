import { useTranslation } from "react-i18next";
import { useLauncherAdsStore } from "../../store/launcher-ads-store";
import { useFriendsStore } from "../../store/friends-store";
import type { AdSize } from "../../services/ads-service";
import { AdSlot } from "./AdSlot";
import { openExternalUrl } from "../../services/tauri-service";

const NORISK_PLUS_URL = "https://norisk.gg/shop";

export const MAIN_AD_SLOT = "play-news";

export function useAdSize(slot: string): AdSize | null {
  const active = useLauncherAdsStore((state) => state.active);
  const size = useLauncherAdsStore((state) => state.slots[slot]);
  return active && size ? size : null;
}

export function AdCaption() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 px-0.5 font-minecraft text-[10px] uppercase tracking-wider text-white/35">
      <span>{t("ads.label")}</span>
      <button
        type="button"
        onClick={() => void openExternalUrl(NORISK_PLUS_URL).catch(() => {})}
        className="truncate uppercase tracking-wider text-white/50 hover:text-white transition-colors"
      >
        {t("ads.ad_free_plus")}
      </button>
    </div>
  );
}

export function AdFrame({ slot, size }: { slot: string; size: AdSize }) {
  const coveredByFriends = useFriendsStore((state) => state.isSidebarOpen);
  return (
    <div
      className="shrink-0 rounded-md overflow-hidden bg-black/40 ring-1 ring-white/10"
      style={{ width: size.width, height: size.height }}
    >
      {!coveredByFriends && <AdSlot slot={slot} />}
    </div>
  );
}
