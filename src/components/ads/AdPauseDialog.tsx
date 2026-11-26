import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { SkinRenderer } from "@noriskclient/nrc-skin-renderer/react";
import type { EmoteAssetUrls } from "@noriskclient/nrc-skin-renderer/core";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { FieldLabel, SegmentedControl } from "../ui/SegmentedControl";
import { PLAIN_TEXT } from "../ui/typography";
import { WebGLBoundary } from "../WebGLBoundary";
import { useLauncherAdsStore } from "../../store/launcher-ads-store";
import { openExternalUrl } from "../../services/tauri-service";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { useActiveSkinTexture } from "../../hooks/useActiveSkinTexture";
import { trackEvent } from "../../services/analytics-service";

export const NORISK_PLUS_URL = "https://norisk.gg/shop";
const EXTRA_PAUSE_DAYS = { today: 0, threeDays: 2, fiveDays: 4 } as const;
type PauseOption = keyof typeof EXTRA_PAUSE_DAYS;
const PAUSE_OPTIONS = Object.keys(EXTRA_PAUSE_DAYS) as PauseOption[];

function pauseEnd(option: PauseOption): number {
  const end = new Date();
  end.setHours(24, 0, 0, 0);
  end.setDate(end.getDate() + EXTRA_PAUSE_DAYS[option]);
  return end.getTime();
}
const MODAL_ID = "ad-pause";
const CUDDLE_DIR = "/emotes/cuddle/";
const CUDDLE_EMOTE: EmoteAssetUrls = {
  animation: `${CUDDLE_DIR}cuddle.animation.json`,
  geo: `${CUDDLE_DIR}cuddle.geo.json`,
  texture: `${CUDDLE_DIR}cuddle.png`,
  particles: [{ jsonUrl: `${CUDDLE_DIR}heart.particle.json`, resolveTexture: () => `${CUDDLE_DIR}heart.png` }],
};

type AdPauseSource = "rail" | "settings";

export function useOpenAdPause(source: AdPauseSource) {
  const { showModal, hideModal } = useGlobalModal();
  return () => {
    void trackEvent("ads_pause_opened", { source });
    showModal(MODAL_ID, <AdPauseDialog onClose={() => hideModal(MODAL_ID)} />);
  };
}

function AdPauseDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const pause = useLauncherAdsStore((state) => state.pause);
  const [option, setOption] = useState<PauseOption>("today");
  const skin = useActiveSkinTexture();

  return (
    <Modal
      title={t("ads.pause.title")}
      titleIcon={<Icon icon="solar:heart-bold" className="w-6 h-6 text-rose-300" />}
      titleClassName={PLAIN_TEXT}
      onClose={onClose}
      width="lg"
      footer={
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void trackEvent("ads_pause_plus_clicked");
              void openExternalUrl(NORISK_PLUS_URL).catch(() => {});
            }}
            className="flex items-center gap-1.5 font-minecraft text-sm text-amber-300 hover:text-amber-200 transition-colors"
          >
            <Icon icon="solar:crown-bold" className="w-4 h-4" />
            {t("ads.pause.forever")}
          </button>
          <Button
            variant="success"
            className={`ml-auto ${PLAIN_TEXT}`}
            onClick={() => {
              pause(pauseEnd(option));
              void trackEvent("ads_paused", { option });
              onClose();
            }}
          >
            {t(`ads.pause.confirm.${option}`)}
          </Button>
        </div>
      }
    >
      <div className="p-6 flex gap-7 font-minecraft normal-case select-none">
        <div className="w-64 h-72 shrink-0">
          {skin.textureUrl && (
            <WebGLBoundary label="ad-pause preview" fallback={null}>
              <SkinRenderer
                textureUrl={skin.textureUrl}
                variant={skin.variant}
                emote={CUDDLE_EMOTE}
                emoteLoop
                zoom={1.75}
                draggable
                dragAxis="yaw"
                fps={30}
                style={{ width: "100%", height: "100%" }}
              />
            </WebGLBoundary>
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-6">
          <div className="space-y-2">
            <p className="text-lg text-white">{t("ads.pause.headline")}</p>
            <p className="text-sm text-white/60 leading-relaxed">{t("ads.pause.why")}</p>
          </div>
          <div className="space-y-2">
            <FieldLabel>{t("ads.pause.duration")}</FieldLabel>
            <SegmentedControl<PauseOption>
              stretch
              value={option}
              onChange={setOption}
              options={PAUSE_OPTIONS.map((value) => ({ value, label: t(`ads.pause.option.${value}`) }))}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
