"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Icon } from "@iconify/react";
import type { Profile } from "../../types/profile";
import { WorldsTab } from "./detail/WorldsTab";
import { LogsTab } from "./detail/LogsTab";
import { BrowseTab } from "./detail/BrowseTab";
import { ScreenshotsTab } from "./detail/ScreenshotsTab";
import * as ProfileService from "../../services/profile-service";
import { useThemeStore } from "../../store/useThemeStore";
import { Button } from "../ui/buttons/Button";
import { IconButton } from "../ui/buttons/IconButton";
import { LaunchButton } from "../ui/buttons/LaunchButton";
import { gsap } from "gsap";
import { cn } from "../../lib/utils";
import { ModsTabV2 } from "./detail/v2/ModsTabV2";
import { LocalContentTabV2 } from "./detail/v2/LocalContentTabV2";
import type { LocalContentItem } from "../../hooks/useLocalContentManager";
import { ProfileIcon } from "./ProfileIcon";
import { useProfileStore } from "../../store/profile-store";
import type { ScreenshotInfo as ActualScreenshotInfo } from "../../types/profile";

interface ProfileDetailViewProps {
  profile: Profile;
  onClose: () => void;
  onEdit: () => void;
  onOpenScreenshotModal: (screenshot: ActualScreenshotInfo) => void;
  screenshotListRefreshKey: number;
}

type MainTabType = "content" | "browse" | "worlds" | "logs" | "screenshots" | "modsv2" | "resourcepacksv2" | "noriskv2" | "datapacksv2" | "shaderpacksv2";
type ContentSubType =
  | "modsv2"
  | "resourcepacksv2"
  | "shaderpacksv2"
  | "datapacksv2"
  | "noriskv2";

export function ProfileDetailView({
  profile,
  onClose,
  onEdit,
  onOpenScreenshotModal,
  screenshotListRefreshKey,
}: ProfileDetailViewProps) {
  const [activeMainTab, setActiveMainTab] = useState<MainTabType>("content");
  const [activeContentType, setActiveContentType] =
    useState<ContentSubType>("modsv2");
  const [currentProfile, setCurrentProfile] = useState<Profile>(profile);
  const [browseContentType, setBrowseContentType] = useState<string>("mods");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const accentColor = useThemeStore((state) => state.accentColor);
  const isSidebarOnLeft = useThemeStore((state) => state.isDetailViewSidebarOnLeft);
  const toggleSidebarPosition = useThemeStore((state) => state.toggleDetailViewSidebarPosition);
  const isBackgroundAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);

  const subMenuRef = useRef<HTMLDivElement>(null);
  const subItemsRef = useRef<(HTMLDivElement | null)[]>([]);
  const prevActiveMainTab = useRef<MainTabType | null>(null);

  // Memoized callback for getDisplayFileName
  const getGenericDisplayFileName = useCallback((item: LocalContentItem) => item.filename, []);

  // Effect to synchronize the internal currentProfile state with the profile prop.
  // This ensures that any updates to the profile data (e.g., name change) are reflected in the view.
  useEffect(() => {
    setCurrentProfile(profile);
  }, [profile]);

  // Effect to reset view states (active tabs, scroll position) when the profile ID changes.
  // This typically happens when navigating to a completely different profile, or after cloning.
  useEffect(() => {
    setActiveMainTab("content"); // Reset to default tab
    setActiveContentType("modsv2"); // Reset to default sub-tab
    if (contentRef.current) {
      contentRef.current.scrollTop = 0; // Scroll to top for new profile
    }
  }, [profile.id]); // Depend on profile.id

  useEffect(() => {
    if (containerRef.current && isBackgroundAnimationEnabled) {
      gsap.fromTo(
        containerRef.current,
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          ease: "power2.out",
        },
      );
    } else if (containerRef.current) {
      gsap.set(containerRef.current, { opacity: 1, y: 0 });
    }
  }, [isBackgroundAnimationEnabled]);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [activeMainTab, activeContentType]);

  useEffect(() => {
    if (contentRef.current && activeMainTab === 'content' && isBackgroundAnimationEnabled) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, scale: 0.98 },
        {
          opacity: 1,
          scale: 1,
          duration: 0.3,
          ease: "power2.out",
          key: activeContentType,
        },
      );
    } else if (contentRef.current && activeMainTab === 'content') {
      gsap.set(contentRef.current, { opacity: 1, scale: 1 });
    }
  }, [activeContentType, activeMainTab, isBackgroundAnimationEnabled, contentRef]);

  const handleBrowseContent = (contentType: string) => {
    setBrowseContentType(contentType);
    handleMainTabChange("browse");
  };

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      const updatedProfile = await ProfileService.getProfile(profile.id);
      useProfileStore.getState().refreshSingleProfileInStore(updatedProfile);
      setCurrentProfile(updatedProfile);
    } catch (error) {
      console.error("Failed to refresh profile:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleMainTabChange = (tab: MainTabType) => {
    if (activeMainTab === tab) return;

    setActiveMainTab(tab);
  };

  const handleContentTypeChange = (type: ContentSubType) => {
    if (activeContentType === type && activeMainTab === "content") return;

    if (isBackgroundAnimationEnabled) {
      gsap.to(`#dot-${activeContentType}`, {
        scale: 0.8,
        opacity: 0.5,
        duration: 0.3,
        ease: "power2.out",
      });

      gsap.fromTo(
        `#dot-${type}`,
        { scale: 0.8, opacity: 0.5 },
        {
          scale: 1.2,
          opacity: 1,
          duration: 0.4,
          ease: "elastic.out(1, 0.5)",
          onComplete: () => {
            gsap.to(`#dot-${type}`, {
              scale: 1,
              duration: 0.2,
              ease: "power2.out",
            });
          },
        },
      );
    }

    setActiveContentType(type);
    if (activeMainTab === "browse") {
      setActiveMainTab("content");
    }
  };

  const mainTabs = [
    { id: "content", label: "Content", icon: "solar:widget-bold" },
    { id: "browse" as MainTabType, label: "Browse", icon: "solar:magnifer-bold" },
    { id: "worlds", label: "Worlds", icon: "solar:planet-bold" },
    { id: "screenshots", label: "Screenshots", icon: "solar:camera-bold" },
    { id: "logs", label: "Logs", icon: "solar:code-bold" },
  ];

  const contentSubTabs = [
    { id: "modsv2" as ContentSubType, label: "Mods", icon: "solar:bolt-bold" },
    {
      id: "resourcepacksv2" as ContentSubType,
      label: "Resource Packs",
      icon: "solar:gallery-bold",
    },
    {
      id: "shaderpacksv2" as ContentSubType,
      label: "Shaders",
      icon: "solar:sun-bold",
    },
    {
      id: "datapacksv2" as ContentSubType,
      label: "Data Packs",
      icon: "solar:database-bold",
    },
    {
      id: "noriskv2" as ContentSubType,
      label: "NoRisk Mods",
      icon: "solar:shield-check-bold",
    },
  ];

  return (
    <div
      ref={containerRef}
      className={cn(
        "h-full flex overflow-hidden",
        isSidebarOnLeft ? "flex-row" : "flex-row-reverse",
      )}
    >
      {/* Sidebar */}
      <div
        className={cn(
          "w-64 h-full flex-shrink-0 backdrop-blur-sm flex flex-col",
          isSidebarOnLeft ? "border-r" : "border-l",
        )}
        style={{
          backgroundColor: `${accentColor.value}15`,
          borderColor: `${accentColor.value}30`,
        }}
      >
        {/* Profile header */}
        <div
          className="p-4 border-b"
          style={{ borderColor: `${accentColor.value}30` }}
        >
          <div className="flex items-center gap-3 mb-3">
            <ProfileIcon
              profileId={currentProfile.id}
              banner={currentProfile.banner}
              profileName={currentProfile.name}
              accentColor={accentColor.value}
              onSuccessfulUpdate={handleRefresh}
              className="w-10 h-10"
            />
            <div className="flex-1 min-w-0">
              <div className="font-minecraft-ten text-base text-white truncate">
                {profile.name || profile.id}
              </div>
              <div className="text-white/60 text-xs font-minecraft-ten">
                {profile.game_version} {profile.loader && `(${profile.loader})`}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onClose}
              icon={<Icon icon="solar:arrow-left-bold" />}
              iconPosition="left"
              className="flex-1"
            >
              Back
            </Button>

            <IconButton
              icon={<Icon icon="solar:settings-bold" />}
              onClick={onEdit}
              title={profile.is_standard_version ? "Java Settings" : "Edit profile"}
              size="sm"
            />

            <IconButton
              icon={<Icon icon="solar:folder-with-files-bold" />}
              onClick={() => ProfileService.openProfileFolder(profile.id)}
              title="Open Profile Folder"
              size="sm"
            />
          </div>
        </div>

        {/* Navigation tabs */}
        <div className="p-3 flex-1 overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between px-2 mb-2">
            <div className="text-white/50 text-sm uppercase tracking-wider">
              Navigation
            </div>
            <IconButton
              icon={
                <Icon
                  icon={
                    isSidebarOnLeft
                      ? "solar:arrow-right-bold"
                      : "solar:arrow-left-bold"
                  }
                  className="w-5 h-5"
                />
              }
              onClick={toggleSidebarPosition}
              title="Toggle Sidebar Position"
              size="xs"
              className="text-white hover:text-white/80"
            />
          </div>
          <div className="flex flex-col gap-1">
            {/* Main navigation buttons */}
            {mainTabs.map((tab) => (
              <div key={tab.id} className="flex flex-col">
                <Button
                  variant={activeMainTab === tab.id ? "default" : "ghost"}
                  size="md"
                  onClick={() => handleMainTabChange(tab.id as MainTabType)}
                  icon={<Icon icon={tab.icon} />}
                  iconPosition="left"
                  className={cn(
                    "justify-start",
                    activeMainTab === tab.id ? "text-white" : "text-white/70",
                  )}
                >
                  {tab.label}
                </Button>

                {/* Content sub-navigation - directly below Content button */}
                {tab.id === "content" &&
                  (activeMainTab === "content" || activeMainTab === "browse") && (
                    <div ref={subMenuRef} className="ml-3 pl-4 relative">
                      {/* Vertical line connecting subpoints */}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-0.5 vertical-line"
                        style={{
                          backgroundColor: `${accentColor.value}50`,
                          transformOrigin: "top",
                        }}
                      ></div>

                      <div className="flex flex-col gap-2 py-2">
                        {contentSubTabs.map((subTab, index) => (
                          <div
                            key={subTab.id}
                            className="flex items-center gap-3"
                            ref={(el) => (subItemsRef.current[index] = el)}
                          >
                            {/* Indicator dot */}
                            <div
                              id={`dot-${subTab.id}`}
                              className={cn(
                                "w-3 h-3 rounded-full flex-shrink-0 transition-all duration-300",
                                activeContentType === subTab.id
                                  ? "shadow-glow"
                                  : `bg-white/30`,
                              )}
                              style={
                                activeContentType === subTab.id
                                  ? {
                                    backgroundColor: accentColor.value,
                                    boxShadow: `0 0 8px ${accentColor.value}80`,
                                  }
                                  : {}
                              }
                            ></div>

                            {/* Button without standard styling */}
                            <button
                              onClick={() => handleContentTypeChange(subTab.id)}
                              className={cn(
                                "flex items-center gap-2.5 py-1.5 px-2.5 rounded-md transition-all duration-200",
                                "text-base font-medium tracking-wide",
                                activeContentType === subTab.id
                                  ? "text-white"
                                  : "text-white/70 hover:text-white/90 hover:bg-white/5",
                              )}
                            >
                              <Icon
                                icon={subTab.icon}
                                className={cn(
                                  "w-5 h-5 transition-transform duration-300",
                                  activeContentType === subTab.id &&
                                  "scale-110",
                                )}
                              />
                              <span>{subTab.label}</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            ))}
          </div>
        </div>

        {/* Divider and Launch Button (Moved here and classes updated) */}
        <div className="mt-auto p-3">
          <div 
            className="h-px w-full mb-3"
            style={{ backgroundColor: `${accentColor.value}30` }} 
          />
          <LaunchButton 
            id={profile.id} 
            name={profile.name} 
            size="md" 
            className="w-full"
          />
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 h-full relative">
        <div
          ref={contentRef}
          className="h-full overflow-y-auto custom-scrollbar"
          style={{
            backgroundColor: `${accentColor.value}08`,
          }}
        >
          <>
            {activeMainTab === "content" && (
              <>
                {activeContentType === "modsv2" && (
                  <LocalContentTabV2<LocalContentItem>
                    profile={currentProfile}
                    contentType="Mod"
                    getDisplayFileName={getGenericDisplayFileName}
                    itemTypeName="mod"
                    itemTypeNamePlural="mods"
                    addContentButtonText="Add Mods"
                    emptyStateIconOverride="solar:gallery-bold-duotone"
                    onRefreshRequired={handleRefresh}
                    onBrowseContentRequest={handleBrowseContent}
                  />
                )}
                {activeContentType === "resourcepacksv2" && (
                  <LocalContentTabV2<LocalContentItem>
                    profile={currentProfile}
                    contentType="ResourcePack"
                    getDisplayFileName={getGenericDisplayFileName}
                    itemTypeName="resource pack"
                    itemTypeNamePlural="resource packs"
                    addContentButtonText="Add Resource Packs"
                    emptyStateIconOverride="solar:gallery-bold-duotone"
                    onRefreshRequired={handleRefresh}
                    onBrowseContentRequest={handleBrowseContent}
                  />
                )}
                {activeContentType === "shaderpacksv2" && (
                  <LocalContentTabV2<LocalContentItem>
                    profile={currentProfile}
                    contentType="ShaderPack"
                    getDisplayFileName={getGenericDisplayFileName}
                    itemTypeName="shader pack"
                    itemTypeNamePlural="shader packs"
                    addContentButtonText="Add Shader Packs"
                    emptyStateIconOverride="solar:sun-bold-duotone"
                    onRefreshRequired={handleRefresh}
                    onBrowseContentRequest={handleBrowseContent}
                  />
                )}
                {activeContentType === "datapacksv2" && (
                  <LocalContentTabV2<LocalContentItem>
                    profile={currentProfile}
                    contentType="DataPack"
                    getDisplayFileName={getGenericDisplayFileName}
                    itemTypeName="data pack"
                    itemTypeNamePlural="data packs"
                    addContentButtonText="Add Data Packs"
                    emptyStateIconOverride="solar:database-bold-duotone"
                    onRefreshRequired={handleRefresh}
                    onBrowseContentRequest={handleBrowseContent}
                  />
                )}
                  {activeContentType === "noriskv2" && (
                  <LocalContentTabV2<LocalContentItem>
                    profile={currentProfile}
                    contentType="NoRiskMod"
                    getDisplayFileName={getGenericDisplayFileName}
                    itemTypeName="NoRisk Mod"
                    itemTypeNamePlural="NoRisk Mods"
                    addContentButtonText="Add NoRisk Mods"
                    emptyStateIconOverride="solar:shield-check-bold-duotone"
                    onRefreshRequired={handleRefresh}
                    onBrowseContentRequest={handleBrowseContent}
                  />
                )}
              </>
            )}
            {activeMainTab === "browse" && (
              <BrowseTab
                profile={currentProfile}
                initialContentType={browseContentType}
                onRefresh={handleRefresh}
                parentTransitionActive={false}
              />
            )}
            {activeMainTab === "worlds" && <WorldsTab profile={currentProfile} />}
            {activeMainTab === "screenshots" && (
              <ScreenshotsTab
                key={`screenshots-tab-${screenshotListRefreshKey}`}
                profile={currentProfile}
                isActive={activeMainTab === "screenshots"}
                onOpenScreenshotModal={onOpenScreenshotModal}
              />
            )}
            {activeMainTab === "logs" && <LogsTab profile={currentProfile} />}
          </>
        </div>
      </div>
    </div>
  );
}
