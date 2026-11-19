import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { Button } from "../../ui/buttons/Button";
import { SettingsSection } from "../../ui/settings/SettingsSection";
import { SettingRow } from "../../ui/settings/SettingRow";
import { isApplixirEnabled } from "../../../services/feature-flags-service";
import { showApplixirAd } from "../../../services/nrc-service";
import { getAdStatus, onAdConsentMode, onAdStatusChanged } from "../../../services/ads-service";
import { useLauncherAdsStore } from "../../../store/launcher-ads-store";
import { useSettingsKeywords } from "./settings-context";

const BUTTON_CLASS = "px-4 py-3 border border-[#ffffff20] hover:bg-white/5 transition-colors";

export function useAdSettings() {
  const [applixir, setApplixir] = useState(false);
  const launcherAds = useLauncherAdsStore((state) => state.active);

  useEffect(() => {
    isApplixirEnabled().then(setApplixir).catch(() => setApplixir(false));
  }, []);

  return { applixir, launcherAds, available: applixir || launcherAds };
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
  const { applixir, launcherAds, available } = useAdSettings();
  const openConsent = useLauncherAdsStore((state) => state.openConsent);
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
        {applixir && (
          <SettingRow
            label={t("settings.ads.reset_consent")}
            description={t("settings.ads.reset_consent.tooltip")}
            searchKeywords={kw("settings.ads.reset_consent", "consent", "werbung", "privacy", "reset", "widerruf")}
          >
            <Button
              variant="ghost"
              className={BUTTON_CLASS}
              onClick={() => {
                showApplixirAd(true).catch(() => toast.error(t("applixir.failed")));
              }}
            >
              {t("settings.ads.reset_consent.button")}
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
