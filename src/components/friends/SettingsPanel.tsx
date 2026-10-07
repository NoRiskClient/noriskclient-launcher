import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n/i18n";
import { Icon } from "@iconify/react";
import { useFriendsStore, OnlineState } from "../../store/friends-store";
import { useThemeStore } from "../../store/useThemeStore";
import { usePlayerAvatar } from "../../hooks/usePlayerAvatar";
import { StatusSelector } from "./StatusSelector";
import { translateApiError } from "../../utils/nrc-error-translations";

const getStatusConfig = (): Record<OnlineState, { color: string; label: string; glow: string }> => ({
  ONLINE: { color: "#22c55e", label: i18n.t('friends.status.online'), glow: "0 0 8px rgba(34, 197, 94, 0.6)" },
  AFK: { color: "#f97316", label: i18n.t('friends.status.away'), glow: "0 0 8px rgba(249, 115, 22, 0.6)" },
  BUSY: { color: "#ef4444", label: i18n.t('friends.status.busy'), glow: "0 0 8px rgba(239, 68, 68, 0.6)" },
  OFFLINE: { color: "#6b7280", label: i18n.t('friends.status.offline'), glow: "none" },
  INVISIBLE: { color: "#6b7280", label: i18n.t('friends.status.invisible'), glow: "none" },
});

interface PrivacyToggleProps {
  label: string;
  description: string;
  enabled: boolean;
  loading: boolean;
  error?: string;
  onToggle: () => void;
  accentColor: string;
}

function PrivacyToggle({ label, description, enabled, loading, error, onToggle, accentColor }: PrivacyToggleProps) {
  const id = useId();
  return (
    <div
      className="flex items-center justify-between p-3 rounded-xl transition-all duration-200"
      style={{
        backgroundColor: `${accentColor}15`,
        border: `1px solid ${accentColor}40`,
      }}
    >
      <div className="flex-1 min-w-0 mr-3">
        <div id={`${id}-label`} className="text-sm font-medium text-white font-minecraft">{label}</div>
        <div id={`${id}-description`} className="text-xs text-white/50 font-smallcaps mt-0.5">{description}</div>
        {error && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-300 font-minecraft break-words">{error}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-busy={loading || undefined}
        aria-labelledby={`${id}-label`}
        aria-describedby={[`${id}-description`, error && `${id}-error`].filter(Boolean).join(" ")}
        onClick={onToggle}
        disabled={loading}
        className="relative w-11 h-6 rounded-full transition-all duration-200 flex-shrink-0 flex items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
        style={{
          backgroundColor: enabled ? `${accentColor}60` : "rgba(255, 255, 255, 0.1)",
          border: `1px solid ${enabled ? accentColor : "rgba(255, 255, 255, 0.2)"}`,
          opacity: loading ? 0.5 : 1,
        }}
      >
        <div
          className="w-4 h-4 rounded-full transition-all duration-200"
          style={{
            backgroundColor: enabled ? accentColor : "rgba(255, 255, 255, 0.4)",
            marginLeft: enabled ? "calc(100% - 1.25rem)" : "0.25rem",
            boxShadow: enabled ? `0 0 6px ${accentColor}` : "none",
          }}
        />
      </button>
    </div>
  );
}

interface SettingsPanelProps {
  onClose?: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps = {}) {
  const { t } = useTranslation();
  const { accentColor } = useThemeStore();
  const { currentUser, closeSettings, updatePrivacySetting } = useFriendsStore();
  const avatarUrl = usePlayerAvatar({ uuid: currentUser?.uuid, size: 64 });
  const [loadingSettings, setLoadingSettings] = useState<Record<string, boolean>>({});
  const [settingErrors, setSettingErrors] = useState<Record<string, string>>({});
  const pendingSettings = useRef(new Set<string>());

  if (!currentUser) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Icon
            icon="svg-spinners:ring-resize"
            className="w-6 h-6"
            style={{ color: accentColor.value }}
          />
          <span className="text-white/60 text-xs">{t('common.loading')}</span>
        </div>
      </div>
    );
  }

  const status = getStatusConfig()[currentUser.state];

  const handleToggle = async (setting: string, currentValue: boolean) => {
    if (pendingSettings.current.has(setting)) return;
    pendingSettings.current.add(setting);
    setSettingErrors((prev) => ({ ...prev, [setting]: "" }));
    setLoadingSettings((prev) => ({ ...prev, [setting]: true }));
    try {
      await updatePrivacySetting(setting, !currentValue);
    } catch (e) {
      console.error("Failed to update privacy setting:", e);
      setSettingErrors((prev) => ({ ...prev, [setting]: translateApiError(e) }));
    } finally {
      pendingSettings.current.delete(setting);
      setLoadingSettings((prev) => ({ ...prev, [setting]: false }));
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div
        className="flex items-center justify-between px-3 py-2.5 shrink-0"
        style={{
          borderBottom: `1px solid ${accentColor.value}40`,
          background: `linear-gradient(90deg, ${accentColor.value}20, ${accentColor.value}10)`,
        }}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-white font-minecraft">{t('common.settings')}</span>
        </div>
        <button
          type="button"
          aria-label={t('common.close')}
          title={t('common.close')}
          onClick={onClose ?? closeSettings}
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/80"
          style={{
            backgroundColor: `${accentColor.value}20`,
            color: accentColor.value,
          }}
        >
          <Icon icon="solar:close-circle-bold" className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        <div
          className="flex flex-col items-center p-5 rounded-xl"
          style={{
            backgroundColor: `${accentColor.value}15`,
            border: `1px solid ${accentColor.value}40`,
          }}
        >
          <div className="relative mb-3">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={currentUser.uuid}
                className="w-16 h-16 rounded-xl"
                style={{
                  border: `3px solid ${accentColor.value}60`,
                  boxShadow: `0 0 20px ${accentColor.value}30`,
                }}
              />
            ) : (
              <div
                className="w-16 h-16 rounded-xl flex items-center justify-center"
                style={{
                  backgroundColor: `${accentColor.value}30`,
                  border: `3px solid ${accentColor.value}60`,
                }}
              >
                <Icon
                  icon="solar:user-bold"
                  className="w-8 h-8"
                  style={{ color: accentColor.value }}
                />
              </div>
            )}
            <div
              className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2"
              style={{
                backgroundColor: status.color,
                boxShadow: status.glow,
                borderColor: `${accentColor.value}40`,
              }}
            />
          </div>
          <div className="text-center">
            <div className="text-white font-minecraft text-sm mb-1">{t('friends.settings.your_profile')}</div>
            <div className="text-white/50 font-smallcaps text-base">{status.label}</div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-white/40 uppercase tracking-wider font-minecraft px-1">
            {t('friends.settings.status')}
          </div>
          <StatusSelector currentStatus={currentUser.state} />
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-white/40 uppercase tracking-wider font-minecraft px-1">
            {t('friends.settings.privacy')}
          </div>
          <div className="space-y-2">
            <PrivacyToggle
              label={t('friends.settings.show_server')}
              description={t('friends.settings.show_server_desc')}
              enabled={currentUser.privacy.showServer}
              loading={loadingSettings.showServer || false}
              error={settingErrors.showServer}
              onToggle={() => handleToggle("showServer", currentUser.privacy.showServer)}
              accentColor={accentColor.value}
            />
            <PrivacyToggle
              label={t('friends.settings.allow_requests')}
              description={t('friends.settings.allow_requests_desc')}
              enabled={currentUser.privacy.allowRequests}
              loading={loadingSettings.allowRequests || false}
              error={settingErrors.allowRequests}
              onToggle={() => handleToggle("allowRequests", currentUser.privacy.allowRequests)}
              accentColor={accentColor.value}
            />
            <PrivacyToggle
              label={t('friends.settings.server_invites')}
              description={t('friends.settings.server_invites_desc')}
              enabled={currentUser.privacy.allowServerInvites}
              loading={loadingSettings.allowServerInvites || false}
              error={settingErrors.allowServerInvites}
              onToggle={() => handleToggle("allowServerInvites", currentUser.privacy.allowServerInvites)}
              accentColor={accentColor.value}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
