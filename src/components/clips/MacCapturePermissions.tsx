import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Button } from "../ui/buttons/Button";
import { StatusMessage } from "../ui/StatusMessage";
import { SettingRow } from "../ui/settings/SettingRow";
import { SettingsSection } from "../ui/settings/SettingsSection";
import { useThemeStore } from "../../store/useThemeStore";
import {
  applyClipSettings,
  openCapturePermissionSettings,
  type CapturePermission,
} from "../../services/clip-service";
import {
  allCapturePermissionsGranted,
  capturePermissionKeys,
  useCapturePermissionsStore,
} from "../../store/capture-permissions-store";
import { parseErrorMessage } from "../../utils/error-utils";

interface Props {
  enabled: boolean;
  saving: boolean;
}

export function MacCapturePermissions({ enabled, saving }: Props) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const { permissions, requested, busy, error, check } = useCapturePermissionsStore();
  const [actionError, setActionError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const ready = allCapturePermissionsGranted(permissions);

  useEffect(() => {
    void check();
  }, [check]);

  const openSettings = async (permission: CapturePermission) => {
    try {
      await openCapturePermissionSettings(permission);
      setActionError(null);
    } catch (err) {
      setActionError(parseErrorMessage(err));
    }
  };

  const retry = async () => {
    setRetrying(true);
    try {
      await applyClipSettings(true);
      setActionError(null);
    } catch (err) {
      setActionError(parseErrorMessage(err));
    } finally {
      setRetrying(false);
      void check();
    }
  };

  const problem = error || actionError;

  return (
    <SettingsSection
      id="settings-section-clips-permissions"
      title={t("settings.clips.permissions.title")}
      description={t(
        ready ? "settings.clips.permissions.ready" : "settings.clips.permissions.description",
      )}
      icon="solar:shield-check-bold"
      keywords={["macOS", "permissions", "Berechtigungen", "microphone", "screen recording"]}
      headerActions={
        <Button size="sm" variant="flat" disabled={!!busy || retrying} onClick={() => void check()}>
          {t("settings.clips.permissions.refresh")}
        </Button>
      }
    >
      {capturePermissionKeys.map((permission) => {
        const granted = !!permissions?.[permission];
        const optional =
          permission === "microphone" && permissions?.microphone_required === false;
        const viaSettings =
          requested.includes(permission) ||
          (permissions?.microphone_denied && permission === "microphone");
        const hint = t(`settings.clips.permissions.${permission}.hint`);

        return (
          <SettingRow
            key={permission}
            label={t(`settings.clips.permissions.${permission}`)}
            description={optional ? `${t("settings.clips.permissions.optional")} · ${hint}` : hint}
          >
            {granted ? (
              <span className="flex items-center gap-1.5 font-minecraft text-xs text-white/60">
                <Icon
                  icon="solar:check-circle-bold"
                  className="h-4 w-4"
                  style={{ color: accentColor.value }}
                />
                {t("settings.clips.permissions.granted")}
              </span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={!!busy || retrying || !permissions}
                onClick={() => void (viaSettings ? openSettings(permission) : check(permission))}
              >
                {t(
                  busy === permission
                    ? "settings.clips.permissions.requesting"
                    : viaSettings
                      ? "settings.clips.permissions.settings"
                      : "settings.clips.permissions.request",
                )}
              </Button>
            )}
          </SettingRow>
        );
      })}

      {!ready && !problem && (
        <StatusMessage
          type={permissions ? "warning" : "info"}
          message={t(
            permissions ? "settings.clips.permissions.blocked" : "settings.clips.permissions.checking",
          )}
          className="mb-0 mt-3"
        />
      )}
      {problem && <StatusMessage type="error" message={problem} className="mb-0 mt-3" />}

      {enabled && ready && (
        <Button
          size="sm"
          className="mt-3"
          disabled={saving || !!busy || retrying}
          onClick={() => void retry()}
        >
          {t("settings.clips.permissions.retry")}
        </Button>
      )}
    </SettingsSection>
  );
}
