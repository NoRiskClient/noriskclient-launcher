import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useCapturePermissionsStore } from "../../store/capture-permissions-store";
import { useClipsStore } from "../../store/clips-store";
import { useSettingsModalStore } from "../../store/settings-modal-store";
import { isMacOS, supportsClips } from "../../utils/platform";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";

export function MacCapturePermissionMonitor() {
  const { t } = useTranslation();
  const enabled = useClipsStore((state) => state.enabled);
  const loaded = useClipsStore((state) => state.loaded);
  const { check, notice, dismiss } = useCapturePermissionsStore();
  const supported = isMacOS() && supportsClips();
  useEffect(() => {
    if (!supported || !loaded) return;
    const refresh = () => {
      void check();
    };
    refresh();
    window.addEventListener("focus", refresh);
    const timer = enabled ? window.setInterval(refresh, 15000) : undefined;
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [check, enabled, loaded, supported]);

  if (!supported || !notice) return null;
  return createPortal(
    <div className="fixed inset-0 z-[1100]">
      <Modal
        title={t(`settings.clips.permissions.${notice.reason}.title`)}
        onClose={dismiss}
        width="sm"
        footer={
          <Button
            onClick={() => {
              dismiss();
              useSettingsModalStore.getState().open("clips");
            }}
          >
            {t("settings.clips.permissions.setup")}
          </Button>
        }
      >
        <div className="p-6 space-y-4 font-minecraft text-sm text-white/80">
          <p>{t(`settings.clips.permissions.${notice.reason}.description`)}</p>
          <ul className="list-disc pl-5 space-y-2">
            {notice.permissions.map((key) => (
              <li key={key}>{t(`settings.clips.permissions.${key}`)}</li>
            ))}
          </ul>
          <p className="text-white/60">
            {t("settings.clips.permissions.blocked")}
          </p>
        </div>
      </Modal>
    </div>,
    document.body,
  );
}
