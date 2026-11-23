import { useEffect, useRef, useState } from "react";
import { AccountAvatar } from "../../account/AccountAvatar";
import { Icon } from "@iconify/react";
import { gsap } from "gsap";
import { useTranslation } from "react-i18next";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "react-hot-toast";

import type { Profile, ProfilePatch } from "../../../types/profile";
import { TYPING_SAVE_DELAY_MS } from "../../../utils/profile-patch";
import type { MinecraftAccount } from "../../../types/minecraft";
import { useThemeStore } from "../../../store/useThemeStore";
import { useMinecraftAuthStore } from "../../../store/minecraft-auth-store";
import { usePlayerAvatar } from "../../../hooks/usePlayerAvatar";
import { SearchStyleInput } from "../../ui/Input";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { ProfileIcon } from "../ProfileIcon";
import { logError } from "../../../utils/logging-utils";
import { Chip, Section } from "./SettingsSection";

interface GeneralSettingsTabProps {
  profile: Profile;
  editedProfile: Profile;
  updateProfile: (patch: ProfilePatch, delayMs?: number) => void;
  onRefresh?: () => Promise<Profile>;
  onDelete?: () => void;
  isDeleting?: boolean;
}

export function GeneralSettingsTab({ profile, editedProfile, updateProfile, onRefresh }: GeneralSettingsTabProps) {
  const { t } = useTranslation();
  const [groupDraft, setGroupDraft] = useState(editedProfile.group || "");
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
  const tabRef = useRef<HTMLDivElement>(null);
  const { accounts } = useMinecraftAuthStore();
  const locked = profile.is_standard_version;

  useEffect(() => {
    if (isBackgroundAnimationEnabled && tabRef.current) {
      gsap.fromTo(tabRef.current, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" });
    }
  }, [isBackgroundAnimationEnabled]);

  const handleCopyProfileId = async () => {
    try {
      await writeText(profile.id);
      toast.success(t("profiles.settings.profileIdCopied"));
    } catch (e) {
      logError(`Failed to copy profile ID: ${e}`);
    }
  };

  return (
    <div ref={tabRef} className="space-y-4 select-none">
      <Section title={t("profiles.settings.general")}>
        <div className="flex items-start gap-4">
          <ProfileIcon
            profileId={profile.id}
            banner={profile.banner}
            profileName={profile.name}
            accentColor={accentColor.value}
            onSuccessfulUpdate={async () => {
              try {
                await onRefresh?.();
              } catch (error) {
                logError(`Failed to refresh profile after icon update: ${error}`);
              }
            }}
            className="h-14 w-14 flex-shrink-0"
          />
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <p className="font-minecraft text-xs text-white/50">{t("profiles.settings.profileName")}</p>
              <SearchStyleInput
                value={editedProfile.name}
                onChange={(e) => updateProfile({ name: e.target.value }, TYPING_SAVE_DELAY_MS)}
                placeholder={t("profiles.settings.enterProfileName")}
                className="text-sm"
                disabled={locked}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <p className="font-minecraft text-xs text-white/50">{t("profiles.settings.group")}</p>
              <SearchStyleInput
                value={groupDraft}
                onChange={(e) => setGroupDraft(e.target.value)}
                onBlur={() => (groupDraft || null) !== (editedProfile.group || null) && updateProfile({ group: groupDraft || null })}
                placeholder={t("placeholders.group_name")}
                className="text-sm"
                disabled={locked}
              />
            </div>
          </div>
        </div>
      </Section>

      <Section
        title={t("profiles.settings.useSharedFolder")}
        description={
          <>
            {t("profiles.settings.sharedFolderDescription")} {t("profiles.settings.canChangeAnytime")}
          </>
        }
        aside={
          <ToggleSwitch
            checked={editedProfile.use_shared_minecraft_folder ?? false}
            onChange={(checked) => updateProfile({ use_shared_minecraft_folder: checked })}
            size="sm"
          />
        }
      />

      <Section title={t("profiles.settings.quickPlayPath")} description={t("profiles.settings.quickPlayDescription")}>
        <SearchStyleInput
          value={editedProfile.settings.quick_play_path || ""}
          onChange={(e) =>
            updateProfile({ settings: { quick_play_path: e.target.value || null } }, TYPING_SAVE_DELAY_MS)
          }
          placeholder={t("profiles.settings.quickPlayPlaceholder")}
          icon="solar:play-bold"
          className="text-sm"
        />
      </Section>

      <Section title={t("profiles.settings.preferredAccount")}>
        {accounts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {accounts.map((account) => {
              const selected = editedProfile.preferred_account_id === account.id;
              return (
                <Chip
                  key={account.id}
                  active={selected}
                  accent={accentColor.value}
                  onClick={() => updateProfile({ preferred_account_id: selected ? null : account.id })}
                  title={`${account.username} (${account.id})`}
                  className="flex items-center gap-2.5 py-1.5 pl-1.5 pr-3"
                >
                  <span className="h-8 w-8 shrink-0 overflow-hidden rounded bg-black/40">
                    <AccountAvatar uuid={account.id} name={account.username} />
                  </span>
                  <span className="max-w-[140px] truncate text-sm normal-case">{account.username}</span>
                  {selected && (
                    <Icon icon="solar:check-circle-bold" className="h-4 w-4 shrink-0" style={{ color: accentColor.value }} />
                  )}
                </Chip>
              );
            })}
          </div>
        ) : (
          <p className="font-minecraft text-sm text-white/50">{t("profiles.settings.noAccountsFound")}</p>
        )}
      </Section>

      <button
        type="button"
        onClick={handleCopyProfileId}
        title={t("profiles.settings.copyProfileId")}
        className="flex items-center gap-1.5 px-1 text-white/30 transition-colors hover:text-white/60"
      >
        <Icon icon="solar:copy-linear" className="h-3.5 w-3.5" />
        <span className="font-minecraft text-xs tracking-wide">{profile.id}</span>
      </button>
    </div>
  );
}
