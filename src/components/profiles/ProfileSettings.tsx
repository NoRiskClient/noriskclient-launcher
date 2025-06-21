"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { gsap } from "gsap";
import type { Profile } from "../../types/profile";
import { GeneralSettingsTab } from "./settings/GeneralSettingsTab";
import { InstallationSettingsTab } from "./settings/InstallationSettingsTab";
import { JavaSettingsTab } from "./settings/JavaSettingsTab";
import { WindowSettingsTab } from "./settings/WindowSettingsTab";
import { ExportSettingsTab } from "./settings/ExportSettingsTab";
import { useProfileStore } from "../../store/profile-store";
import * as ProfileService from "../../services/profile-service";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { useThemeStore } from "../../store/useThemeStore";
import { toast } from "react-hot-toast";
import { Card } from "../ui/Card";
import { cn } from "../../lib/utils";
import { useFlags } from 'flagsmith/react';
import { DesignerSettingsTab } from './settings/DesignerSettingsTab';

interface ProfileSettingsProps {
  profile: Profile;
  onClose: () => void;
}

type SettingsTab =
  | "general"
  | "installation"
  | "java"
  | "window"
  | "export_options"
  | "designer";

const DESIGNER_FEATURE_FLAG_NAME = "show_keep_local_assets";

export function ProfileSettings({ profile, onClose }: ProfileSettingsProps) {
  const { updateProfile, deleteProfile } = useProfileStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [editedProfile, setEditedProfile] = useState<Profile>({ ...profile });
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [systemRam, setSystemRam] = useState<number>(8192);
  const contentRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );

  const flags = useFlags([DESIGNER_FEATURE_FLAG_NAME]);
  const showDesignerTab = flags[DESIGNER_FEATURE_FLAG_NAME]?.enabled === true;

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

  const updateProfileData = (updates: Partial<Profile>) => {
    setEditedProfile((prev) => ({ ...prev, ...updates }));
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await updateProfile(profile.id, {
        name: editedProfile.name,
        game_version: editedProfile.game_version,
        loader: editedProfile.loader,
        loader_version: editedProfile.loader_version || null || undefined,
        settings: editedProfile.settings,
        selected_norisk_pack_id:
          editedProfile.selected_norisk_pack_id || null || undefined,
        group: editedProfile.group,
        description: editedProfile.description,
        norisk_information: editedProfile.norisk_information,
      });

      toast.success("Profile saved successfully!");
    } catch (err) {
      console.error("Failed to save profile:", err);
      toast.error("Failed to save profile. Please try again.");
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
          loading: `Deleting profile '${profile.name}'...`,
          success: () => {
            onClose();
            return `Profile '${profile.name}' deleted successfully!`;
          },
          error: (err) => {
            const errorMessage =
              err instanceof Error ? err.message : String(err.message);
            return `Failed to delete profile: ${errorMessage}`;
          },
        })
        .finally(() => {
          setIsDeleting(false);
        });
    } catch (err) {
      console.error("Error during delete initiation:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to initiate profile deletion: ${errorMessage}`);
      setIsDeleting(false);
    }
  };

  const baseTabConfig = [
    { id: "general", label: "General", icon: "solar:settings-bold" },
    { id: "installation", label: "Installation", icon: "solar:download-bold" },
    { id: "java", label: "Java", icon: "solar:code-bold" },
    { id: "window", label: "Window", icon: "solar:widget-bold" },
    { id: "export_options", label: "Export", icon: "solar:export-bold" },
  ];

  const tabConfig = showDesignerTab
    ? [
        ...baseTabConfig,
        { id: "designer", label: "Designer", icon: "solar:palette-bold" },
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
            profile={profile}
            editedProfile={editedProfile}
            updateProfile={updateProfileData}
            onDelete={handleDelete}
            isDeleting={isDeleting}
          />
        );
      case "installation":
        return (
          <InstallationSettingsTab
            profile={profile}
            editedProfile={editedProfile}
            updateProfile={updateProfileData}
          />
        );
      case "java":
        return (
          <JavaSettingsTab
            editedProfile={editedProfile}
            updateProfile={updateProfileData}
            systemRam={systemRam}
          />
        );
      case "window":
        return (
          <WindowSettingsTab
            editedProfile={editedProfile}
            updateProfile={updateProfileData}
          />
        );
      case "export_options":
        return <ExportSettingsTab profile={profile} onClose={onClose} />;
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
        cancel
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
            <span>saving...</span>
          </div>
        ) : (
          "save changes"
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

  return (    <Modal
      title={`profile settings: ${profile.name}`}
      onClose={onClose}
      width="xl"
      footer={renderFooter()}
    ><div className="flex h-[500px] overflow-hidden">
        <Card
          ref={sidebarRef}
          className="w-64 overflow-y-auto custom-scrollbar bg-black/20 border border-white/10 p-4"
          variant="flat"
        >
          <div className="space-y-3">
            {tabConfig.map((tab) => {
              const isActive = activeTab === tab.id;

              return (
                <div key={tab.id} className="w-full">
                  <Button
                    variant={isActive ? "default" : "ghost"}
                    size="lg"
                    className={cn(
                      "w-full text-left justify-start p-3 transition-all duration-200",
                      isActive
                        ? "bg-black/30 border-accent border-b-[3px] hover:bg-black/30"
                        : "bg-transparent hover:bg-black/20 border-transparent",
                    )}
                    onClick={() => handleTabClick(tab.id)}
                  >
                    <div className="flex items-center gap-3">
                      <Icon
                        icon={tab.icon}
                        className={cn(
                          "w-6 h-6",
                          isActive ? "text-accent" : "text-white/70",
                        )}
                      />
                      <span className="font-minecraft text-3xl lowercase">
                        {tab.label}
                      </span>
                    </div>
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div
            className="flex-1 p-5 overflow-y-auto custom-scrollbar"
            ref={contentRef}
          >
            {renderTabContent()}
          </div>
        </div>
      </div>
    </Modal>
  );
}
