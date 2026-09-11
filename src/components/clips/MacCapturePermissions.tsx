import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/buttons/Button";
import { SettingsSection } from "../ui/settings/SettingsSection";
import { SettingRow } from "../ui/settings/SettingRow";
import {
  applyClipSettings,
  getCapturePermissions,
  openCapturePermissionSettings,
  type CapturePermission,
  type CapturePermissions,
} from "../../services/clip-service";
import { parseErrorMessage } from "../../utils/error-utils";

interface Props {
  microphone: boolean;
  hotkeys: boolean;
  enabled: boolean;
  saving: boolean;
  onReadyChange: (ready: boolean) => void;
}

export function MacCapturePermissions({
  microphone,
  hotkeys,
  enabled,
  saving,
  onReadyChange,
}: Props) {
  const { t } = useTranslation();
  const [permissions, setPermissions] = useState<CapturePermissions | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const ready =
    !!permissions?.screen_recording &&
    (!microphone || !!permissions?.microphone) &&
    (!hotkeys || !!permissions?.input_monitoring);

  const read = useCallback(async (request?: CapturePermission) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(request ?? "refresh");
    try {
      setPermissions(await getCapturePermissions(request));
      setError(null);
    } catch (error) {
      setPermissions(null);
      setError(parseErrorMessage(error));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void read();
    const refresh = () => {
      void read();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [read]);

  useEffect(() => {
    onReadyChange(ready);
  }, [ready, onReadyChange]);

  const rows: { permission: CapturePermission; required: boolean }[] = [
    { permission: "screen_recording", required: true },
    { permission: "input_monitoring", required: hotkeys },
    { permission: "microphone", required: microphone },
  ];

  return (
    <SettingsSection
      id="settings-section-clips-permissions"
      title={t("settings.clips.permissions.title")}
      description={t("settings.clips.permissions.description")}
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
          variant="secondary"
          disabled={busy !== null}
          onClick={() => void read()}
        >
          {t("settings.clips.permissions.refresh")}
        </Button>
      }
    >
      {rows.map(({ permission, required }) => (
        <SettingRow
          key={permission}
          label={t(`settings.clips.permissions.${permission}`)}
          description={t(`settings.clips.permissions.${permission}.hint`)}
          className="flex-wrap [&>div:last-child]:max-w-full"
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span
              className={`font-minecraft text-xs ${permissions?.[permission] ? "text-green-400" : "text-white/60"}`}
            >
              {permissions?.[permission]
                ? t("settings.clips.permissions.granted")
                : !permissions
                  ? t("settings.clips.permissions.unchecked")
                  : t(
                      required
                        ? "settings.clips.permissions.required"
                        : "settings.clips.permissions.optional",
                    )}
            </span>
            {!permissions?.[permission] && (
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => void read(permission)}
              >
                {t("settings.clips.permissions.request")}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => {
                openCapturePermissionSettings(permission).catch((error) =>
                  setError(parseErrorMessage(error)),
                );
              }}
            >
              {t("settings.clips.permissions.settings")}
            </Button>
          </div>
        </SettingRow>
      ))}
      <p className="font-minecraft text-xs text-white/50 py-2">
        {t("settings.clips.permissions.hint")}
      </p>
      {error && (
        <p role="alert" className="font-minecraft text-sm text-red-400 py-2">
          {error}
        </p>
      )}
      {ready && (
        <p role="status" className="font-minecraft text-sm text-green-400 py-2">
          {t("settings.clips.permissions.ready")}
        </p>
      )}
      {enabled && (
        <Button
          size="sm"
          disabled={!ready || saving || busy !== null}
          onClick={async () => {
            inFlight.current = true;
            setBusy("retry");
            try {
              await applyClipSettings(true);
              setError(null);
            } catch (error) {
              setError(parseErrorMessage(error));
            } finally {
              inFlight.current = false;
              setBusy(null);
            }
          }}
        >
          {t("settings.clips.permissions.retry")}
        </Button>
      )}
    </SettingsSection>
  );
}
