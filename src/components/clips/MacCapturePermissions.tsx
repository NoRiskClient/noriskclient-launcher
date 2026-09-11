import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Button } from "../ui/buttons/Button";
import { SettingsSection } from "../ui/settings/SettingsSection";
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
  const { permissions, requested, busy, error, check } =
    useCapturePermissionsStore();
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
    } catch (error) {
      setActionError(parseErrorMessage(error));
    }
  };

  return (
    <SettingsSection
      id="settings-section-clips-permissions"
      title={t("settings.clips.permissions.title")}
      description={t(
        ready
          ? "settings.clips.permissions.ready"
          : "settings.clips.permissions.description",
      )}
      icon="solar:shield-check-bold"
      keywords={[
        "macOS",
        "permissions",
        "Berechtigungen",
        "microphone",
        "screen recording",
      ]}
      headerActions={
        <Button
          size="sm"
          variant="flat"
          disabled={!!busy || retrying}
          onClick={() => void check()}
        >
          {t("settings.clips.permissions.refresh")}
        </Button>
      }
    >
      <div className="divide-y divide-white/10">
        {capturePermissionKeys.map((permission) => {
          const granted = !!permissions?.[permission];
          const settings =
            requested.includes(permission) ||
            (permissions?.microphone_denied && permission === "microphone");
          return (
            <div key={permission} className="flex items-center gap-3 py-3">
              <Icon
                icon={
                  granted
                    ? "solar:check-circle-bold"
                    : "solar:lock-keyhole-linear"
                }
                className={`h-5 w-5 shrink-0 ${granted ? "text-green-400" : "text-white/40"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="font-minecraft text-sm text-white">
                  {t(`settings.clips.permissions.${permission}`)}
                </p>
                {!ready && (
                  <p className="mt-1 text-xs text-white/50">
                    {t(`settings.clips.permissions.${permission}.hint`)}
                  </p>
                )}
              </div>
              {granted ? (
                <span className="text-xs text-green-400">
                  {t("settings.clips.permissions.granted")}
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!!busy || retrying || !permissions}
                  onClick={() =>
                    void (settings
                      ? openSettings(permission)
                      : check(permission))
                  }
                >
                  {t(
                    busy === permission
                      ? "settings.clips.permissions.requesting"
                      : settings
                        ? "settings.clips.permissions.settings"
                        : "settings.clips.permissions.request",
                  )}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {!ready && (
        <p className="font-minecraft text-xs text-white/50 pt-3" role="status">
          {t(
            permissions
              ? "settings.clips.permissions.blocked"
              : "settings.clips.permissions.checking",
          )}
        </p>
      )}
      {(error || actionError) && (
        <p role="alert" className="font-minecraft text-sm text-red-400 pt-3">
          {error || actionError}
        </p>
      )}
      {enabled && ready && (
        <Button
          size="sm"
          className="mt-3"
          disabled={saving || !!busy || retrying}
          onClick={async () => {
            setRetrying(true);
            try {
              await applyClipSettings(true);
              setActionError(null);
            } catch (error) {
              setActionError(parseErrorMessage(error));
            } finally {
              setRetrying(false);
              void check();
            }
          }}
        >
          {t("settings.clips.permissions.retry")}
        </Button>
      )}
    </SettingsSection>
  );
}
