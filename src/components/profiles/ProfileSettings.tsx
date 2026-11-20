import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { gsap } from "gsap";
import type { Profile, ProfilePatch } from "../../types/profile";
import { GeneralSettingsTab } from "./settings/GeneralSettingsTab";
import { InstallationSettingsTab } from "./settings/InstallationSettingsTab";
import { JavaSettingsTab } from "./settings/JavaSettingsTab";
import { WindowSettingsTab } from "./settings/WindowSettingsTab";
import { NRCTab } from "./settings/NRCTab";
import { SymlinkSettingsTab } from "./settings/SymlinkSettingsTab";

import { useProfileStore } from "../../store/profile-store";
import * as ProfileService from "../../services/profile-service";
import { logError } from "../../utils/logging-utils";
import { Modal } from "../ui/Modal";
import { useThemeStore } from "../../store/useThemeStore";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { parseErrorMessage } from "../../utils/error-utils";
import { applyPatch, mergePatches } from "../../utils/profile-patch";

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
  | "symlinks";

export function ProfileSettings({ profile, onClose }: ProfileSettingsProps) {
  const { t } = useTranslation();
  const { patchProfile, deleteProfile } = useProfileStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [editedProfile, setEditedProfile] = useState<Profile>({ ...profile });
  const [currentProfile, setCurrentProfile] = useState<Profile>({ ...profile });
  const [isDeleting, setIsDeleting] = useState(false);
  const [systemRam, setSystemRam] = useState<number>(8192);
  const [recommendedRam, setRecommendedRam] = useState<number>(4096);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const { accentColor } = useThemeStore();
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );

  const [tempRamMb, setTempRamMb] = useState(profile.settings?.memory?.max ?? 0);

  useEffect(() => {
    ProfileService.getSystemRamMb()
      .then((ram) => setSystemRam(ram))
      .catch((err) => {
        logError(`Failed to get system RAM: ${err}`);
      });

    ProfileService.getDefaultMemoryMaxMb()
      .then((recommended) => {
        setRecommendedRam(recommended);
        setTempRamMb((current) => (current === 0 ? recommended : current));
      })
      .catch((err) => {
        logError(`Failed to get the recommended memory default: ${err}`);
        setTempRamMb((current) => (current === 0 ? 4096 : current));
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
    setTempRamMb(profile.settings?.memory?.max ?? recommendedRam);
  }, [profile]);

  const pendingPatch = useRef<ProfilePatch>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const flushPatch = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const patch = pendingPatch.current;
    pendingPatch.current = {};
    if (Object.keys(patch).length === 0) return;
    try {
      await patchProfile(profile.id, patch);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      logError(`Failed to save profile ${profile.id}: ${err}`);
      toast.error(t("profiles.settings.saveError"));
    }
  }, [patchProfile, profile.id, t]);

  const updateProfileData = useCallback((patch: ProfilePatch, delayMs = 0) => {
    setEditedProfile((prev) => applyPatch(prev, patch));
    pendingPatch.current = mergePatches(pendingPatch.current, patch);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushPatch, delayMs);
  }, [flushPatch]);

  useEffect(() => () => void flushPatch(), [flushPatch]);

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
              parseErrorMessage(err);
            return t('profiles.deleteError', { error: errorMessage });
          },
        })
        .finally(() => {
          setIsDeleting(false);
        });
    } catch (err) {
      console.error("Error during delete initiation:", err);
      const errorMessage = parseErrorMessage(err);
      toast.error(t('profiles.deleteInitError', { error: errorMessage }));
      setIsDeleting(false);
    }
  };

  const tabConfig = [
    { id: "general", label: t('profiles.settings.general'), icon: "solar:settings-bold" },
    { id: "installation", label: t('profiles.settings.installation'), icon: "solar:download-minimalistic-bold" },
    { id: "java", label: t('profiles.settings.javaMemory'), icon: "solar:code-bold" },
    { id: "window", label: t('profiles.settings.window'), icon: "solar:window-frame-bold" },
    { id: "nrc", label: t('profiles.settings.nrc'), icon: "solar:shield-check-bold" },
    { id: "symlinks", label: t('profiles.settings.symlinks'), icon: "solar:link-bold" },
  ];

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
            recommendedRam={recommendedRam}
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

      case "symlinks":
        return (
          <SymlinkSettingsTab
            editedProfile={editedProfile}
            allProfiles={useProfileStore.getState().profiles}
          />
        );
      default:
        return null;
    }
  };

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
      className="!max-w-6xl h-[85vh] min-h-[600px] flex flex-col"
    >
      <div className="flex h-full p-4 gap-2">
        <div
          ref={sidebarRef}
          className="w-64 flex flex-col flex-shrink-0"
        >
          <div className="space-y-0.5 flex-1 overflow-y-auto scrollbar-hover">
            {tabConfig.map((tab) => {
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-lg transition-colors border-0 outline-none flex items-center gap-3",
                    isActive
                      ? "text-white"
                      : "bg-transparent text-white/60 hover:bg-white/5 hover:text-white/90",
                  )}
                  style={isActive ? { backgroundColor: `${accentColor.value}26` } : undefined}
                  onClick={() => handleTabClick(tab.id)}
                >
                  <Icon
                    icon={tab.icon}
                    className="w-6 h-6 transition-colors duration-200"
                    style={{ color: isActive ? accentColor.value : undefined }}
                  />
                  <span
                    className={cn(
                      "font-smallcaps text-lg transition-colors duration-200",
                      isActive && "font-medium",
                    )}
                  >
                    {tab.label}
                  </span>
                </button>
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
            className="flex-1 py-2 px-5 overflow-y-auto overflow-x-hidden custom-scrollbar min-w-0"
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
