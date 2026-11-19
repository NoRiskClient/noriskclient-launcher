import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/buttons/Button";
import { answerAdConsent, type AdConsentAnswer } from "../../services/ads-service";
import { useLauncherAdsStore } from "../../store/launcher-ads-store";
import { log } from "../../utils/logging-utils";

const answer = (action: AdConsentAnswer) => {
  answerAdConsent(action).catch((error) => log("error", `Failed to answer the ad privacy prompt: ${error}`));
};

function AdConsentPrompt() {
  const { t } = useTranslation();
  return (
    <div
      role="dialog"
      aria-labelledby="ad-consent-title"
      className="fixed bottom-6 right-6 z-[10000] w-[380px] max-w-[calc(100vw-48px)] rounded-lg border-2 border-white/15 bg-black/85 p-5 backdrop-blur-lg font-minecraft"
    >
      <h2 id="ad-consent-title" className="font-smallcaps text-lg text-white">
        {t("ads.consent.title")}
      </h2>
      <p className="mt-2 text-sm leading-snug text-white/70">{t("ads.consent.text")}</p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => answer("customize")}>
          {t("ads.consent.customize")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => answer("reject")}>
          {t("ads.consent.reject")}
        </Button>
        <Button size="sm" onClick={() => answer("accept")}>
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
