import { useState } from "react";
import { Icon } from "@iconify/react";
import { useFriendsStore, OnlineState } from "../../store/friends-store";
import { useThemeStore } from "../../store/useThemeStore";
import { useCrafatarAvatar } from "../../hooks/useCrafatarAvatar";
import { StatusSelector } from "./StatusSelector";
import { toast } from "../ui/GlobalToaster";

const statusConfig: Record<OnlineState, { color: string; label: string; glow: string }> = {
  ONLINE: { color: "#22c55e", label: "Online", glow: "0 0 8px rgba(34, 197, 94, 0.6)" },
  AFK: { color: "#f97316", label: "Away", glow: "0 0 8px rgba(249, 115, 22, 0.6)" },
  BUSY: { color: "#ef4444", label: "Busy", glow: "0 0 8px rgba(239, 68, 68, 0.6)" },
  OFFLINE: { color: "#6b7280", label: "Offline", glow: "none" },
  INVISIBLE: { color: "#6b7280", label: "Invisible", glow: "none" },
};

interface PrivacyToggleProps {
  label: string;
  description: string;
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
  accentColor: string;
}

function PrivacyToggle({ label, description, enabled, loading, onToggle, accentColor }: PrivacyToggleProps) {
  return (
    <div
      className="flex items-center justify-between p-3 rounded-xl transition-all duration-200"
      style={{
        backgroundColor: `${accentColor}15`,
        border: `1px solid ${accentColor}40`,
      }}
    >
      <div className="flex-1 min-w-0 mr-3">
        <div className="text-sm font-medium text-white font-minecraft-ten">{label}</div>
        <div className="text-lg text-white/50 font-minecraft mt-0.5">{description}</div>
      </div>
      <button
        onClick={onToggle}
        disabled={loading}
        className="relative w-11 h-6 rounded-full transition-all duration-200 flex-shrink-0 flex items-center"
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

export function SettingsPanel() {
  const { accentColor } = useThemeStore();
  const { currentUser, closeSettings, updatePrivacySetting } = useFriendsStore();
  const avatarUrl = useCrafatarAvatar({ uuid: currentUser?.uuid, size: 64 });
  const [loadingSettings, setLoadingSettings] = useState<Record<string, boolean>>({});

  if (!currentUser) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Icon
            icon="solar:refresh-linear"
            className="w-6 h-6 animate-spin"
            style={{ color: accentColor.value }}
          />
          <span className="text-white/60 text-xs">Loading...</span>
        </div>
      </div>
    );
  }

  const status = statusConfig[currentUser.state];

  const settingLabels: Record<string, string> = {
    showServer: "Show Server",
    allowRequests: "Allow Requests",
    allowServerInvites: "Server Invites",
  };

  const handleToggle = async (setting: string, currentValue: boolean) => {
    setLoadingSettings((prev) => ({ ...prev, [setting]: true }));
    try {
      await updatePrivacySetting(setting, !currentValue);
      const label = settingLabels[setting] || setting;
      toast.info(`${label} ${!currentValue ? "enabled" : "disabled"}`);
    } catch (e) {
      console.error("Failed to update privacy setting:", e);
    } finally {
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
          <button
            onClick={closeSettings}
            className="p-1.5 rounded-lg transition-all duration-200"
            style={{
              backgroundColor: `${accentColor.value}20`,
              color: accentColor.value,
            }}
          >
            <Icon icon="solar:arrow-left-linear" className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-white font-minecraft-ten">Settings</span>
        </div>
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
            <div className="text-white font-minecraft-ten text-sm mb-1">Your Profile</div>
            <div className="text-white/50 font-minecraft text-2xl">{status.label}</div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-white/40 uppercase tracking-wider font-minecraft-ten px-1">
            Status
          </div>
          <StatusSelector currentStatus={currentUser.state} />
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-white/40 uppercase tracking-wider font-minecraft-ten px-1">
            Privacy
          </div>
          <div className="space-y-2">
            <PrivacyToggle
              label="Show Server"
              description="Friends see your server"
              enabled={currentUser.privacy.showServer}
              loading={loadingSettings.showServer || false}
              onToggle={() => handleToggle("showServer", currentUser.privacy.showServer)}
              accentColor={accentColor.value}
            />
            <PrivacyToggle
              label="Allow Requests"
              description="Players can send requests"
              enabled={currentUser.privacy.allowRequests}
              loading={loadingSettings.allowRequests || false}
              onToggle={() => handleToggle("allowRequests", currentUser.privacy.allowRequests)}
              accentColor={accentColor.value}
            />
            <PrivacyToggle
              label="Server Invites"
              description="Friends can invite you"
              enabled={currentUser.privacy.allowServerInvites}
              loading={loadingSettings.allowServerInvites || false}
              onToggle={() => handleToggle("allowServerInvites", currentUser.privacy.allowServerInvites)}
              accentColor={accentColor.value}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
