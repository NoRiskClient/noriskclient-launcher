import { useCallback } from "react";
import { create } from "zustand";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { ProgressToast } from "../components/ui/ProgressToast";
import { openExternalUrl } from "../services/tauri-service";
import {
  onShareProgress,
  shareErrorKey,
  shareMedia,
  type ShareExpiry,
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
    async (target: ShareTarget, expiry?: ShareExpiry) => {
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
        const { pageUrl } = await shareMedia(target, progressId, expiry);
        finished = true;
        const copied = await writeText(pageUrl).then(
          () => true,
          () => false,
        );
        toast.success(
          (shown) => (
            <span className="flex items-center gap-3">
              <span>{copied ? t("share.done_copied") : t("share.done")}</span>
              <button
                type="button"
                onClick={() => {
                  toast.dismiss(shown.id);
                  openExternalUrl(pageUrl).catch((e) => console.error("Could not open the share", e));
                }}
                className="shrink-0 px-2 py-1 rounded-md border border-white/15 text-white/70 hover:text-white hover:border-white/35 transition-colors"
              >
                {t("share.open")}
              </button>
            </span>
          ),
          { id: toastId, duration: 10_000 },
        );
      } catch (e) {
        finished = true;
        console.error("Could not share", e);
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
