import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/buttons/Button";
import { SettingsSection } from "../../ui/settings/SettingsSection";
import { SettingRow } from "../../ui/settings/SettingRow";
import { getAdStatus, onAdConsentMode, onAdStatusChanged } from "../../../services/ads-service";
import { useLauncherAdsStore } from "../../../store/launcher-ads-store";
import { useSettingsKeywords } from "./settings-context";
import { useOpenAdPause } from "../../ads/AdPauseDialog";

const BUTTON_CLASS = "px-4 py-3 border border-[#ffffff20] hover:bg-white/5 transition-colors";

export function useAdSettings() {
  const launcherAds = useLauncherAdsStore((state) => state.active);
  return { launcherAds, available: launcherAds };
}

function usePersonalizedAds(enabled: boolean) {
  const [personalized, setPersonalized] = useState<boolean | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const load = () => {
      getAdStatus()
        .then((status) => setPersonalized(status.personalized))
        .catch(() => setPersonalized(null));
    };
    load();
    const unlisten = [onAdStatusChanged(load), onAdConsentMode(load)];
    return () => unlisten.forEach((stop) => stop.then((off) => off()).catch(() => {}));
  }, [enabled]);

  return personalized;
}

export function AdsTab() {
  const { t } = useTranslation();
  const kw = useSettingsKeywords();
  const { launcherAds, available } = useAdSettings();
  const openConsent = useLauncherAdsStore((state) => state.openConsent);
  const pausedUntil = useLauncherAdsStore((state) => state.pausedUntil);
  const resume = useLauncherAdsStore((state) => state.resume);
  const openPause = useOpenAdPause();
  const personalized = usePersonalizedAds(launcherAds);
  const personalizedLabel =
    personalized === null
      ? t("settings.ads.personalized.unknown")
      : personalized
        ? t("settings.ads.personalized.on")
        : t("settings.ads.personalized.off");

  if (!available) return null;

  return (
    <div className="space-y-6">
      <SettingsSection
        id="settings-section-ads"
        title={t("settings.sections.ads")}
        icon="solar:play-circle-bold"
        keywords={kw("settings.sections.ads", "ads", "werbung", "consent", "privacy", "gdpr", "dsgvo")}
      >
        {launcherAds && (
          <SettingRow
            label={t("settings.ads.pause")}
            description={
              pausedUntil
                ? t("settings.ads.pause.until", { date: new Date(pausedUntil).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) })
                : t("settings.ads.pause.off")
            }
            searchKeywords={kw("settings.ads.pause", "pause", "pausieren", "werbung", "ads", "timer")}
          >
            <Button variant="ghost" className={BUTTON_CLASS} onClick={pausedUntil ? resume : openPause}>
              {pausedUntil ? t("settings.ads.pause.resume") : t("settings.ads.pause.button")}
            </Button>
          </SettingRow>
        )}
        {launcherAds && (
          <SettingRow
            label={t("settings.ads.privacy")}
            description={t("settings.ads.privacy.tooltip")}
            searchKeywords={kw("settings.ads.privacy", "consent", "werbung", "privacy", "datenschutz")}
          >
            <Button variant="ghost" className={BUTTON_CLASS} onClick={openConsent}>
              {t("settings.ads.privacy.button")}
            </Button>
          </SettingRow>
        )}
        {launcherAds && (
          <SettingRow
            label={t("settings.ads.personalized")}
            description={t("settings.ads.personalized.tooltip")}
            searchKeywords={kw("settings.ads.personalized", "personalized", "personalisiert", "tracking", "consent")}
          >
            <span className="font-minecraft text-sm text-white/70">{personalizedLabel}</span>
          </SettingRow>
        )}
      </SettingsSection>
    </div>
  );
}
