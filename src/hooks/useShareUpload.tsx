import { useCallback } from "react";
import { create } from "zustand";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";

import { ProgressToast } from "../components/ui/ProgressToast";
import { showShareSuccess } from "../components/share/share-toast";
import { logError } from "../utils/logging-utils";
import {
  onShareProgress,
  shareErrorKey,
  shareMedia,
  type ShareOptions,
  type ShareTarget,
} from "../services/share-service";

const useSharing = create<{ paths: string[] }>(() => ({ paths: [] }));

function markSharing(path: string, sharing: boolean) {
  useSharing.setState(({ paths }) => ({
    paths: sharing ? [...paths, path] : paths.filter((p) => p !== path),
  }));
}

export function useShareUpload() {
  const { t } = useTranslation();
  const paths = useSharing((state) => state.paths);

  const share = useCallback(
    async (target: ShareTarget, options?: ShareOptions) => {
      if (useSharing.getState().paths.includes(target.path)) return;
      markSharing(target.path, true);

      const progressId = crypto.randomUUID();
      const toastId = `share-${progressId}`;
      const uploading =
        target.kind === "clip" ? t("share.uploading_clip") : t("share.uploading_screenshot");
      const show = (message: string, done: number, total: number) =>
        toast.custom(
          () => <ProgressToast message={message} progress={(done / total) * 100} />,
          { id: toastId, duration: Infinity },
        );

      let finished = false;
      show(uploading, 0, 1);
      const unlisten = await onShareProgress(progressId, ({ phase, done, total }) => {
        if (finished) return;
        if (phase === "checking") {
          toast.loading(t("share.checking"), { id: toastId });
        } else if (phase === "converting" && total === 0) {
          toast.loading(t("share.converting"), { id: toastId });
        } else {
          show(phase === "converting" ? t("share.converting") : uploading, done, Math.max(total, 1));
        }
      }).catch(() => null);

      try {
        const { pageUrl } = await shareMedia(target, progressId, options);
        finished = true;
        await showShareSuccess(pageUrl, toastId);
      } catch (e) {
        finished = true;
        logError(`Could not share: ${e}`);
        toast.error(t(shareErrorKey(e)), { id: toastId, duration: 6_000 });
      } finally {
        unlisten?.();
        markSharing(target.path, false);
      }
    },
    [t],
  );

  const isSharing = useCallback((path: string) => paths.includes(path), [paths]);

  return { share, isSharing };
}
