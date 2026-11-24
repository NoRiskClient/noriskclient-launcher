import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Button } from "../ui/buttons/Button";
import { PLAIN_TEXT } from "../ui/typography";
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
      data-ad-passthrough
      aria-labelledby="ad-consent-title"
      className="fixed bottom-6 right-6 z-[10000] w-[440px] max-w-[calc(100vw-48px)] rounded-lg border-2 p-4 backdrop-blur-lg font-minecraft normal-case select-none"
      style={{
        borderColor: `${accent}66`,
        background: `linear-gradient(180deg, ${accent}26, ${accent}0d), rgba(0, 0, 0, 0.85)`,
      }}
    >
      <div className="flex items-center gap-2">
        <Icon icon="solar:shield-check-bold" className="w-4 h-4 shrink-0" style={{ color: accent }} />
        <h2 id="ad-consent-title" className="font-minecraft normal-case tracking-normal text-sm text-white">
          {t("ads.consent.title")}
        </h2>
      </div>
      <p className="mt-1.5 text-xs leading-snug text-white/60">{t("ads.consent.text")}</p>
      <div className="mt-4 flex items-center gap-2">
        <Button variant="secondary" size="sm" className={PLAIN_TEXT} onClick={() => answer("customize")}>
          {t("ads.consent.customize")}
        </Button>
        <Button variant="flat" size="sm" className={`ml-auto ${PLAIN_TEXT}`} onClick={() => answer("reject")}>
          {t("ads.consent.reject")}
        </Button>
        <Button variant="flat" size="sm" className={PLAIN_TEXT} onClick={() => answer("accept")}>
          {t("ads.consent.accept")}
        </Button>
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
