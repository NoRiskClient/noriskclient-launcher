"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import type { CheckContentParams, Profile } from "../../types/profile";
import { ProfileGroup } from "./ProfileGroup";
import type { ModrinthVersion } from "../../types/modrinth";
import { isContentInstalled } from "../../services/profile-service";
import { useThemeStore } from "../../store/useThemeStore";
import { Button } from "../ui/buttons/Button";
import { Modal } from "../ui/Modal";

interface ProfileSelectionPopupProps {
  profiles: Profile[];
  onSelect: (profileId: string) => void;
  onCancel: () => void;
  title?: string;
  description?: string;
  contentVersion?: ModrinthVersion;
}

export function ProfileSelectionPopup({
  profiles = [],
  onSelect,
  onCancel,
  title,
  description,
  contentVersion,
}: ProfileSelectionPopupProps) {
  const { t } = useTranslation();
  const resolvedTitle = title || t('modrinth.select_profile');
  const resolvedDescription = description || t('modrinth.choose_profile_to_install');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    profiles && profiles.length > 0 ? profiles[0].id : null,
  );
  const [installedProfiles, setInstalledProfiles] = useState<
    Record<string, boolean>
  >({});
  const [isInstalling, setIsInstalling] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isCheckingInstalled, setIsCheckingInstalled] = useState(true);
  const accentColor = useThemeStore((state) => state.accentColor);

  // Group profiles by loader and check compatibility
  const profilesByLoader: Record<string, Profile[]> = {};
  const compatibleProfiles: Record<string, boolean> = {};

  // Add debug logging to the ProfileSelectionPopup component
  console.log(
    "ProfileSelectionPopup - Profiles:",
    profiles.length,
    "Content version:",
    contentVersion?.name || contentVersion?.version_number,
  );

  if (profiles && profiles.length > 0) {
    profiles.forEach((profile) => {
      const loader = profile.loader || "Unknown";
      if (!profilesByLoader[loader]) {
        profilesByLoader[loader] = [];
      }
      profilesByLoader[loader].push(profile);

      if (contentVersion) {
        let isCompatible = true;

        if (
          contentVersion.game_versions &&
          contentVersion.game_versions.length > 0
        ) {
          isCompatible =
            isCompatible &&
            contentVersion.game_versions.includes(profile.game_version);
        }

        if (
          contentVersion.search_hit?.project_type === "mod" ||
          contentVersion.search_hit?.project_type === "modpack"
        ) {
          if (contentVersion.loaders && contentVersion.loaders.length > 0) {
            isCompatible =
              isCompatible && contentVersion.loaders.includes(profile.loader);
          }
        } else {
          isCompatible = true;
        }

        compatibleProfiles[profile.id] = isCompatible;
      } else {
        compatibleProfiles[profile.id] = true;
      }
    });
  }

  useEffect(() => {
    async function checkInstalledStatus() {
      if (!contentVersion || !contentVersion.project_id || !contentVersion.id) {
        setIsCheckingInstalled(false);
        return;
      }

      setIsCheckingInstalled(true);
      const installedStatus: Record<string, boolean> = {};

      try {
        console.log(
          `Checking installation status for ${contentVersion.project_id} (${contentVersion.id})`,
        );

        const batchSize = 5;
        for (let i = 0; i < profiles.length; i += batchSize) {
          const batch = profiles.slice(i, i + batchSize);
          const batchPromises = batch.map(async (profile) => {
            try {
              const params: CheckContentParams = {
                project_id: contentVersion.project_id,
                version_id: contentVersion.id,
                project_type: contentVersion.search_hit?.project_type || "mod",
                profile_id: profile.id,
              };

              const status = await isContentInstalled(params);
              installedStatus[profile.id] = status.is_installed;
            } catch (error) {
              console.error(
                `Error checking installation status for profile ${profile.id}:`,
                error,
              );
              installedStatus[profile.id] = false;
            }
          });

          await Promise.all(batchPromises);
        }

        setInstalledProfiles(installedStatus);
        console.log("Installation status check complete:", installedStatus);
      } catch (error) {
        console.error("Error checking installation status:", error);
      } finally {
        setIsCheckingInstalled(false);
      }
    }

    checkInstalledStatus();
  }, [contentVersion, profiles]);

  useEffect(() => {
    if (selectedProfileId && !compatibleProfiles[selectedProfileId]) {
      const firstCompatibleProfile = profiles.find(
        (p) => compatibleProfiles[p.id],
      );
      if (firstCompatibleProfile) {
        console.log(
          "Selected profile not compatible, switching to:",
          firstCompatibleProfile.name,
        );
        setSelectedProfileId(firstCompatibleProfile.id);
      }
    }

    if (!selectedProfileId && profiles.length > 0) {
      const firstCompatibleProfile = profiles.find(
        (p) => compatibleProfiles[p.id],
      );
      if (firstCompatibleProfile) {
        console.log(
          "No profile selected, selecting first compatible:",
          firstCompatibleProfile.name,
        );
        setSelectedProfileId(firstCompatibleProfile.id);
      } else {
        console.log("No compatible profiles found, selecting first profile");
        setSelectedProfileId(profiles[0].id);
      }
    }
  }, [compatibleProfiles, selectedProfileId, profiles]);

  const handleInstall = async (event: React.MouseEvent) => {
    // Prevent default action that might cause page reload
    event?.preventDefault?.();

    if (!selectedProfileId) return;

    setIsInstalling(true);

    try {
      await onSelect(selectedProfileId);
      setIsInstalled(true);

      setInstalledProfiles((prev) => ({
        ...prev,
        [selectedProfileId]: true,
      }));

      // Don't close the popup automatically
      // The parent component will handle closing after successful installation
    } catch (error) {
      console.error("Installation failed:", error);
      setIsInstalling(false);
      // Keep popup open on error so user can try again
    }
  };

  const modalFooter = (
    <div className="flex justify-end gap-3">
      <Button
        variant="secondary"
        size="md"
        onClick={(e) => {
          e.preventDefault();
          onCancel();
        }}
      >
        {isInstalled ? t('common.close') : t('common.cancel')}
      </Button>

      {selectedProfileId && installedProfiles[selectedProfileId] ? (
        <Button variant="success" size="md" disabled>
          {t('common.installed')}
        </Button>
      ) : (
        <Button
          variant="default"
          size="md"
          onClick={handleInstall}
          disabled={
            !selectedProfileId ||
            (selectedProfileId && !compatibleProfiles[selectedProfileId]) ||
            isInstalling ||
            isInstalled ||
            isCheckingInstalled
          }
          icon={
            isInstalling ? (
              <Icon icon="pixel:circle-notch-solid" className="animate-spin" />
            ) : undefined
          }
        >
          {isInstalling
            ? t('modrinth.installing')
            : isInstalled
              ? t('common.installed')
              : t('modrinth.install')}
        </Button>
      )}
    </div>
  );

  return (
    <Modal title={resolvedTitle} onClose={onCancel} footer={modalFooter} width="md">
      <div className="p-4">
        <p className="text-white/70 font-minecraft text-sm mb-4 tracking-wide lowercase select-none">
          {resolvedDescription}
        </p>

        {contentVersion && (
          <div
            className="mb-4 p-3 border-2 border-b-4 rounded-md shadow-inner"
            style={{
              backgroundColor: `${accentColor.value}20`,
              borderColor: `${accentColor.value}30`,
              borderBottomColor: `${accentColor.value}40`,
            }}
          >
            <h4 className="text-white font-minecraft text-base mb-1 tracking-wide lowercase select-none">
              {t('modrinth.content_details')}:
            </h4>
            <div className="text-white/70 font-minecraft text-xs tracking-wide lowercase select-none">
              <div className="flex items-center gap-2 mb-1">
                <Icon icon="pixel:cube" className="w-4 h-4" />
                <span>
                  {t('mod_detail.type')}: {contentVersion.search_hit?.project_type || t('common.unknown')}
                </span>
              </div>
              {contentVersion.game_versions &&
                contentVersion.game_versions.length > 0 && (
                  <div className="flex items-center gap-2 mb-1">
                    <Icon icon="pixel:gamepad-solid" className="w-4 h-4" />
                    <span>
                      {t('modrinth.game_versions')}: {contentVersion.game_versions.join(", ")}
                    </span>
                  </div>
                )}
              {(contentVersion.search_hit?.project_type === "mod" ||
                contentVersion.search_hit?.project_type === "modpack") &&
                contentVersion.loaders &&
                contentVersion.loaders.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Icon icon="pixel:cog-solid" className="w-4 h-4" />
                    <span>{t('modrinth.mod_loaders')}: {contentVersion.loaders.join(", ")}</span>
                  </div>
                )}
            </div>
          </div>
        )}

        {isCheckingInstalled ? (
          <div className="flex justify-center items-center py-4">
            <div
              className="w-6 h-6 mr-2 rounded-full border-2 border-t-2 animate-spin"
              style={{
                borderColor: `${accentColor.value}40`,
                borderTopColor: accentColor.value,
              }}
            ></div>
            <span className="text-white/70 font-minecraft text-sm tracking-wide lowercase select-none">
              {t('modrinth.checking_installation_status')}
            </span>
          </div>
        ) : (
          <div
            className="max-h-[50vh] overflow-y-auto custom-scrollbar pr-2 rounded-md border-2"
            style={{
              borderColor: `${accentColor.value}30`,
              scrollbarColor: `${accentColor.value}50 transparent`,
            }}
          >
            {Object.entries(profilesByLoader).map(
              ([loader, loaderProfiles]) => (
                <ProfileGroup
                  key={loader}
                  loader={loader}
                  profiles={loaderProfiles}
                  selectedProfileId={selectedProfileId}
                  onSelectProfile={setSelectedProfileId}
                  compatibleProfiles={compatibleProfiles}
                  installedProfiles={installedProfiles}
                />
              ),
            )}

            {Object.keys(profilesByLoader).length === 0 && (
              <EmptyProfilesMessage />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function EmptyProfilesMessage() {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);

  return (
    <div className="text-center py-8">
      <div
        className="w-14 h-14 mx-auto mb-4 rounded-full border-2 border-b-4 flex items-center justify-center"
        style={{
          backgroundColor: `${accentColor.value}20`,
          borderColor: `${accentColor.value}30`,
          borderBottomColor: `${accentColor.value}40`,
        }}
      >
        <Icon
          icon="pixel:exclamation-triangle-solid"
          className="w-8 h-8 text-white/70"
        />
      </div>
      <p className="text-white/60 font-minecraft text-sm tracking-wide lowercase select-none">
        {t('profiles.no_profiles_available')}
      </p>
      <p className="text-white/40 font-minecraft text-xs mt-2 tracking-wide lowercase select-none">
        {t('profiles.create_profile_first')}
      </p>
    </div>
  );
}
