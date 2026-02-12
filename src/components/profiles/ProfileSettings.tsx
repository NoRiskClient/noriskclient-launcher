"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { gsap } from "gsap";
import type { Profile } from "../../types/profile";
import { GeneralSettingsTab } from "./settings/GeneralSettingsTab";
import { InstallationSettingsTab } from "./settings/InstallationSettingsTab";
import { JavaSettingsTab } from "./settings/JavaSettingsTab";
import { WindowSettingsTab } from "./settings/WindowSettingsTab";
import { NRCTab } from "./settings/NRCTab";
import { SymlinkSettingsTab } from "./settings/SymlinkSettingsTab";

import { useProfileStore } from "../../store/profile-store";
import * as ProfileService from "../../services/profile-service";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { useThemeStore } from "../../store/useThemeStore";
import { toast } from "react-hot-toast";
import { useFlags } from 'flagsmith/react';
import { useTranslation } from "react-i18next";
import { DesignerSettingsTab } from './settings/DesignerSettingsTab';
import { cn } from "../../lib/utils";

interface ProfileSettingsProps {
  profile: Profile;
  onClose: () => void;
}

type SettingsTab =
  | "general"
  | "installation"
  | "java"
  | "window"
  | "nrc"
  | "designer"
  | "symlinks";

const DESIGNER_FEATURE_FLAG_NAME = "show_keep_local_assets";

export function ProfileSettings({ profile, onClose }: ProfileSettingsProps) {
  const { t } = useTranslation();
  const { updateProfile, deleteProfile } = useProfileStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [editedProfile, setEditedProfile] = useState<Profile>({ ...profile });
  const [currentProfile, setCurrentProfile] = useState<Profile>({ ...profile });
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [systemRam, setSystemRam] = useState<number>(8192);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const { accentColor } = useThemeStore();
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );

  const flags = useFlags([DESIGNER_FEATURE_FLAG_NAME]);
  const showDesignerTab = flags[DESIGNER_FEATURE_FLAG_NAME]?.enabled === true;
  const [tempRamMb, setTempRamMb] = useState(profile.settings?.memory?.max ?? 3072);

  useEffect(() => {
    ProfileService.getSystemRamMb()
      .then((ram) => setSystemRam(ram))
      .catch((err) => {
        console.error("Failed to get system RAM:", err);
      });
  }, []);

  useEffect(() => {
    if (isBackgroundAnimationEnabled && contentRef.current) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" },
      );
    }
  }, [activeTab, isBackgroundAnimationEnabled]);

  useEffect(() => {
    if (isBackgroundAnimationEnabled && sidebarRef.current) {
      gsap.fromTo(
        sidebarRef.current,
        { opacity: 0, x: -20 },
        { opacity: 1, x: 0, duration: 0.4, ease: "power2.out" },
      );
    }
  }, [isBackgroundAnimationEnabled]);

  useEffect(() => {
    setTempRamMb(profile.settings?.memory?.max ?? 3072);
  }, [profile]);

  const updateProfileData = (updates: Partial<Profile>) => {
    setEditedProfile((prev) => ({ ...prev, ...updates }));
  };

  const handleRefresh = async () => {
    try {
      const updatedProfile = await ProfileService.getProfile(profile.id);
      setCurrentProfile(updatedProfile);
      setEditedProfile(updatedProfile);
      
      // Update the global store as well to sync with ProfilesTab
      useProfileStore.getState().refreshSingleProfileInStore(updatedProfile);
      
      return updatedProfile;
    } catch (error) {
      console.error("Failed to refresh profile:", error);
      throw error;
    }
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await updateProfile(profile.id, {
        name: editedProfile.name,
        game_version: editedProfile.game_version,
        loader: editedProfile.loader,
        loader_version: editedProfile.loader_version || null || undefined,
        settings: {
          ...editedProfile.settings,
          // Only save memory settings for custom profiles
          // Standard profiles save memory to global settings directly via JavaSettingsTab
          ...(profile.is_standard_version ? {} : {
            memory: {
              ...editedProfile.settings?.memory,
              max: tempRamMb,
            },
          }),
        },
        selected_norisk_pack_id: editedProfile.selected_norisk_pack_id,
        clear_selected_norisk_pack: !editedProfile.selected_norisk_pack_id,
        group: editedProfile.group,
        clear_group: !editedProfile.group,
        description: editedProfile.description,
        norisk_information: editedProfile.norisk_information,
        use_shared_minecraft_folder: editedProfile.use_shared_minecraft_folder,
        preferred_account_id: editedProfile.preferred_account_id,
        clear_preferred_account: !editedProfile.preferred_account_id,
      });

      toast.success(t('profiles.settings.saveSuccess'));
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error("Failed to save profile:", err);
      toast.error(t('profiles.settings.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      const deletePromise = deleteProfile(profile.id);

      toast
        .promise(deletePromise, {
          loading: t('profiles.deletingProfile', { name: profile.name }),
          success: () => {
            onClose();
            return t('profiles.deleteSuccess', { name: profile.name });
          },
          error: (err) => {
            const errorMessage =
              err instanceof Error ? err.message : String(err.message);
            return t('profiles.deleteError', { error: errorMessage });
          },
        })
        .finally(() => {
          setIsDeleting(false);
        });
    } catch (err) {
      console.error("Error during delete initiation:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(t('profiles.deleteInitError', { error: errorMessage }));
      setIsDeleting(false);
    }
  };

  const baseTabConfig = [
    { id: "general", label: t('profiles.settings.general'), icon: "solar:settings-bold" },
    { id: "installation", label: t('profiles.settings.installation'), icon: "solar:download-bold" },
    { id: "java", label: t('profiles.settings.javaMemory'), icon: "solar:code-bold" },
    { id: "window", label: t('profiles.settings.window'), icon: "solar:widget-bold" },
    { id: "nrc", label: t('profiles.settings.nrc'), icon: "solar:gamepad-bold" },
    { id: "symlinks", label: t('profiles.settings.symlinks'), icon: "solar:link-bold" },
  ];

  const tabConfig = showDesignerTab
    ? [
        ...baseTabConfig,
        { id: "designer", label: t('profiles.settings.designer'), icon: "solar:palette-bold" },
      ]
    : baseTabConfig;

  useEffect(() => {
    if (activeTab === "designer" && !showDesignerTab) {
      setActiveTab("general");
    }
  }, [activeTab, showDesignerTab]);

  const renderTabContent = () => {
    switch (activeTab) {
      case "general":
        return (
          <GeneralSettingsTab
            profile={currentProfile}
            editedProfile={editedProfile}
            updateProfile={updateProfileData}
            onDelete={handleDelete}
            isDeleting={isDeleting}
            onRefresh={handleRefresh}
          />
        );
      case "installation":
        return (
          <InstallationSettingsTab
            profile={profile}
            editedProfile={editedProfile}
            updateProfile={updateProfileData}
            refreshTrigger={refreshTrigger}
          />
        );
      case "java":
        return (
          <JavaSettingsTab
            editedProfile={editedProfile}
            updateProfile={updateProfileData}
            systemRam={systemRam}
            tempRamMb={tempRamMb}
            setTempRamMb={setTempRamMb}
          />
        );
      case "window":
        return (
          <WindowSettingsTab
            editedProfile={editedProfile}
            updateProfile={updateProfileData}
          />
        );
      case "nrc":
        return (
          <NRCTab
            profile={profile}
            editedProfile={editedProfile}
            updateProfile={updateProfileData}
            onRefresh={handleRefresh}
          />
        );

      case "designer":
        if (showDesignerTab) {
          return (
            <DesignerSettingsTab
              editedProfile={editedProfile}
              updateProfile={updateProfileData}
            />
          );
        }
        return null;
      case "symlinks":
        return (
          <SymlinkSettingsTab
            editedProfile={editedProfile}
            updateProfile={updateProfileData}
            allProfiles={useProfileStore.getState().profiles}
          />
        );
      default:
        return null;
    }
  };

  const renderFooter = () => (
    <div className="flex justify-between">
      <Button
        variant="secondary"
        onClick={onClose}
        size="md"
        className="text-2xl"
      >
        {t('profiles.settings.cancel')}
      </Button>
      <Button
        variant="default"
        onClick={handleSave}
        disabled={isSaving}
        size="md"
        className="text-2xl"
      >
        {isSaving ? (
          <div className="flex items-center gap-3">
            <Icon
              icon="solar:refresh-bold"
              className="w-6 h-6 animate-spin text-white"
            />
            <span>{t('profiles.settings.saving')}</span>
          </div>
        ) : (
          t('profiles.settings.saveChanges')
        )}
      </Button>
    </div>
  );

  const handleTabClick = (tabId: string) => {
    if (activeTab !== tabId) {
      if (isBackgroundAnimationEnabled && contentRef.current) {
        gsap.to(contentRef.current, {
          opacity: 0,
          y: 20,
          duration: 0.2,
          ease: "power2.in",
          onComplete: () => setActiveTab(tabId as SettingsTab),
        });
      } else {
        setActiveTab(tabId as SettingsTab);
      }
    }
  };

  return (
    <Modal
      title={t('profiles.settings.title', { name: profile.name })}
      onClose={onClose}
      width="xl"
      footer={renderFooter()}
      className="h-[650px] min-h-[550px] flex flex-col"
    >
      <div className="flex h-full">
        <div
          ref={sidebarRef}
          className="w-64 flex flex-col"
        >
          <div className="space-y-0 flex-1">
            {tabConfig.map((tab) => {
              const isActive = activeTab === tab.id;

              return (
                <div key={tab.id} className="w-full">
                  <button
                    className={cn(
                      "w-full text-left p-3 transition-all duration-200 rounded-none relative border-0 outline-none",
                      isActive
                        ? "border-l-2 shadow-sm text-white"
                        : "bg-transparent border-transparent text-white/70 hover:text-white",
                    )}
                    style={
                      isActive
                        ? {
                            backgroundColor: `${accentColor.value}10`, // 60% opacity
                            borderLeftColor: accentColor.value,
                            color: "white"
                          }
                        : {
                            "--hover-bg": `${accentColor.value}33` // 20% opacity for hover
                          } as any
                    }
                    onClick={() => handleTabClick(tab.id)}
                  >
                    <div className="flex items-center gap-3">
                      <Icon
                        icon={tab.icon}
                        className={cn(
                          "w-6 h-6 transition-colors duration-200",
                          isActive ? "" : "text-white/50",
                        )}
                        style={isActive ? { color: accentColor.value } : {}}
                      />
                      <span
                        className={cn(
                          "font-minecraft text-3xl lowercase transition-colors duration-200",
                          isActive ? "font-medium" : "",
                        )}
                        style={isActive ? { color: accentColor.value } : {}}
                      >
                        {tab.label}
                      </span>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Vertical separator line */}
        <div className="flex items-center">
          <div className="border-l border-white/10 mx-4 my-3 h-[85%]"></div>
        </div>

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div
            className="flex-1 py-2 pl-0 pr-4 overflow-y-auto overflow-x-hidden custom-scrollbar min-w-0"
            ref={contentRef}
            style={{ maxWidth: '100%', boxSizing: 'border-box' }}
          >
            {renderTabContent()}
          </div>
        </div>
      </div>
    </Modal>
  );
}
