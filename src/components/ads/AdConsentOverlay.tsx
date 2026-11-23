import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { AccentButton } from "../ui/AccentButton";
import { useThemeStore } from "../../store/useThemeStore";
import { answerAdConsent, type AdConsentAnswer } from "../../services/ads-service";
import { useLauncherAdsStore } from "../../store/launcher-ads-store";
import { log } from "../../utils/logging-utils";

const answer = (action: AdConsentAnswer) => {
  answerAdConsent(action).catch((error) => log("error", `Failed to answer the ad privacy prompt: ${error}`));
};

function AdConsentPrompt() {
  const { t } = useTranslation();
  const accent = useThemeStore((state) => state.accentColor.value);
  return (
    <div
      role="dialog"
      aria-labelledby="ad-consent-title"
      className="fixed bottom-6 right-6 z-[10000] w-[400px] max-w-[calc(100vw-48px)] rounded-lg border-2 p-5 backdrop-blur-lg font-minecraft normal-case select-none"
      style={{
        borderColor: `${accent}66`,
        background: `linear-gradient(180deg, ${accent}26, ${accent}0d), rgba(12, 10, 20, 0.92)`,
      }}
    >
      <div className="flex items-center gap-2">
        <Icon icon="solar:shield-check-bold" className="w-5 h-5 shrink-0" style={{ color: accent }} />
        <h2 id="ad-consent-title" className="font-minecraft normal-case tracking-normal text-base text-white">
          {t("ads.consent.title")}
        </h2>
      </div>
      <p className="mt-2 text-sm leading-snug text-white/65">{t("ads.consent.text")}</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <AccentButton onClick={() => answer("customize")}>{t("ads.consent.customize")}</AccentButton>
        <AccentButton onClick={() => answer("reject")}>{t("ads.consent.reject")}</AccentButton>
        <AccentButton onClick={() => answer("accept")}>{t("ads.consent.accept")}</AccentButton>
      </div>
    </div>
  );
}

export function AdConsentOverlay() {
  const { active, consent } = useLauncherAdsStore();

  if (!active || consent === "closed") return null;

  return createPortal(
    consent === "prompt" ? (
      <AdConsentPrompt />
    ) : (
      <div className="fixed inset-0 z-[10000] bg-black/70" aria-hidden="true" />
    ),
    document.body,
  );
}
