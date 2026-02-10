"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type React from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import type { Profile } from "../../types/profile";
import { ProfileIconV2 } from "./ProfileIconV2";
import { useThemeStore } from "../../store/useThemeStore";
import { Button } from "../ui/buttons/Button";
import { IconButton } from "../ui/buttons/IconButton";
import { ActionButtons, type ActionButton } from "../ui/ActionButtons";
import { ActionButton as SingleActionButton } from "../ui/ActionButton";
import { GroupTabs, type GroupTab } from "../ui/GroupTabs";
import { LocalContentTabV2 } from "./detail/v2/LocalContentTabV2";
import { SettingsContextMenu, type ContextMenuItem } from "../ui/SettingsContextMenu";
import { ConfirmDeleteDialog } from "../modals/ConfirmDeleteDialog";
import { ExportProfileModal } from "./ExportProfileModal";
import { ModpackVersionsModal } from "../modals/ModpackVersionsModal";
import { useProfileStore } from "../../store/profile-store";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import * as ProfileService from "../../services/profile-service";
import UnifiedService from "../../services/unified-service";
import type { UnifiedModpackVersionsResponse } from "../../types/unified";
import { useProfileDuplicateStore } from "../../store/profile-duplicate-store";
import { useProfileLaunch } from "../../hooks/useProfileLaunch.tsx";
import { useAppDragDropStore } from "../../store/appStore";

import { WorldsTab } from "./detail/WorldsTab";
import { ScreenshotsTab } from "./detail/ScreenshotsTab";
import { LogsTab } from "./detail/LogsTab";
import type { LocalContentItem } from "../../hooks/useLocalContentManager";
import { ModpackDebugInfo } from "../../debug";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { Tooltip } from "../ui/Tooltip";
import { useCrafatarAvatar } from "../../hooks/useCrafatarAvatar";
import { parseMotdToHtml } from "../../utils/motd-utils";

type MainTabType = "content" | "worlds" | "logs" | "screenshots";
type ContentTabType = "mods" | "resourcepacks" | "datapacks" | "shaderpacks" | "nrc";

interface ProfileDetailViewV2Props {
  profile: Profile;
  onClose: () => void;
  onEdit: () => void;
}

export function ProfileDetailViewV2({
  profile,
  onClose,
  onEdit,
}: ProfileDetailViewV2Props) {
  const navigate = useNavigate();
  const [currentProfile, setCurrentProfile] = useState<Profile>(profile);
  const [activeMainTab, setActiveMainTab] = useState<MainTabType>("content");
  const [activeContentTab, setActiveContentTab] = useState<ContentTabType>("mods");
  const accentColor = useThemeStore((state) => state.accentColor);

  // Context menu state
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const contextMenuId = `profile-detail-${profile.id}`;
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  // Delete modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Modpack versions state
  const [modpackVersions, setModpackVersions] = useState<UnifiedModpackVersionsResponse | null>(null);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);

  // Global modal system
  const { showModal, hideModal } = useGlobalModal();

  // Get theme store functions
  const { openContextMenuId, setOpenContextMenuId } = useThemeStore();

  // Profile store
  const { fetchProfiles } = useProfileStore();

  // Drag and drop store
  const { setActiveMainTab: setDragDropMainTab } = useAppDragDropStore();

  // Profile duplicate store
  const { openModal: openDuplicateModal } = useProfileDuplicateStore();

  // Get accounts from Minecraft Auth Store
  const accounts = useMinecraftAuthStore((state) => state.accounts);

  // Find preferred account if one is set
  const preferredAccount = currentProfile.preferred_account_id 
    ? accounts.find(acc => acc.id === currentProfile.preferred_account_id)
    : null;

  // Load preferred account avatar
  const preferredAccountAvatarUrl = useCrafatarAvatar({
    uuid: preferredAccount?.id,
    overlay: true,
  });

  // Profile launch hook
  const { isLaunching, statusMessage, handleLaunch, handleQuickPlayLaunch } = useProfileLaunch({
    profileId: profile.id,
    onLaunchSuccess: () => {
      console.log("Profile launched successfully:", profile.name);
    },
    onLaunchError: (error) => {
      console.error("Profile launch error:", error);
    },
  });

  // Handler for world/server launch requests from WorldsTab
  const handleLaunchRequest = useCallback(async (params: {
    profileId: string;
    quickPlaySingleplayer?: string;
    quickPlayMultiplayer?: string;
  }) => {
    console.log("🚀 Launch request received:", params);

    if (params.quickPlaySingleplayer) {
      // Launch with specific world using QuickPlay
      console.log(`🚀 QuickPlay Singleplayer: Launching world: ${params.quickPlaySingleplayer}`);
      toast.success(`🚀 Launching world: ${params.quickPlaySingleplayer}`);
      handleQuickPlayLaunch(params.quickPlaySingleplayer, undefined);
    } else if (params.quickPlayMultiplayer) {
      // Launch with specific server using QuickPlay
      console.log(`🌐 QuickPlay Multiplayer: Joining server: ${params.quickPlayMultiplayer}`);
      toast.success(`🌐 Joining server: ${params.quickPlayMultiplayer}`);
      handleQuickPlayLaunch(undefined, params.quickPlayMultiplayer);
    } else {
      // Regular launch
      console.log("Regular launch");
      handleQuickPlayLaunch(undefined, undefined);
    }
  }, [handleQuickPlayLaunch]);

  // Settings context menu items
  const contextMenuItems: ContextMenuItem[] = [
    {
      id: "edit",
      label: "Edit Profile",
      icon: "solar:settings-bold",
      onClick: () => onEdit(),
    },
    {
      id: "duplicate",
      label: "Duplicate",
      icon: "solar:copy-bold",
      onClick: () => handleDuplicateProfile(),
    },
    {
      id: "export",
      label: "Export",
      icon: "solar:download-bold",
      onClick: () => handleOpenExportModal(),
    },
    // Show modpack versions only if modpack info exists and versions are loaded
    ...(currentProfile.modpack_info && modpackVersions ? [{
      id: "modpack-versions",
      label: "Modpack Versions",
      icon: "solar:archive-bold",
      onClick: () => handleOpenModpackVersionsModal(),
    }] : []),
    {
      id: "open-folder",
      label: "Open Folder",
      icon: "solar:folder-bold",
      onClick: () => handleOpenFolder(),
    },
    {
      id: "delete",
      label: "Delete",
      icon: "solar:trash-bin-trash-bold",
      destructive: true,
      separator: true, // Trennstrich vor Delete
      onClick: () => handleDeleteProfile(),
    },
  ];

  // Memoized callback for getDisplayFileName
  const getGenericDisplayFileName = useCallback((item: LocalContentItem) => item.filename, []);

  // Handler for refreshing profile data
  const handleRefresh = useCallback(() => {
    // Profile refresh logic would go here
    console.log("Refreshing profile data");
  }, []);

  // Handler for browse content requests
  const handleBrowseContent = useCallback((contentType: string) => {
    console.log("Browse content requested for:", contentType);
    // Navigate to the browse route instead of just changing the tab
    navigate(`/profilesv2/${profile.id}/browse/${contentType}`);
  }, [navigate, profile.id]);

  // Handler for deleting profile
  const handleDeleteProfile = useCallback(() => {
    console.log("[ProfileDetailViewV2] handleDeleteProfile called for:", currentProfile.id, currentProfile.name);

    // Check if it's a standard version
    if (currentProfile.is_standard_version) {
      toast.error("Standard profiles cannot be deleted.");
      return;
    }

    // Open delete confirmation modal
    setIsDeleteModalOpen(true);
  }, [currentProfile]);

  // Handler for confirming profile deletion
  const handleConfirmDelete = useCallback(async () => {
    setIsDeleting(true);

    try {
      const deletePromise = useProfileStore.getState().deleteProfile(currentProfile.id);
      await toast.promise(deletePromise, {
        loading: `Deleting profile '${currentProfile.name}'...`,
        success: () => {
          fetchProfiles();
          navigate("/profiles");
          setIsDeleteModalOpen(false);
          return `Profile '${currentProfile.name}' deleted successfully!`;
        },
        error: (err) =>
          `Failed to delete profile: ${err instanceof Error ? err.message : String(err.message)}`,
      });
    } catch (error) {
      console.error("Delete failed:", error);
    } finally {
      setIsDeleting(false);
    }
  }, [currentProfile, fetchProfiles, navigate]);

  // Handler for canceling delete
  const handleCancelDelete = useCallback(() => {
    setIsDeleteModalOpen(false);
  }, []);



  // Handler for opening export modal
  const handleOpenExportModal = useCallback(() => {
    showModal(`export-profile-${currentProfile.id}`, (
      <ExportProfileModal
        profile={currentProfile}
        isOpen={true}
        onClose={() => hideModal(`export-profile-${currentProfile.id}`)}
      />
    ));
  }, [currentProfile, showModal, hideModal]);

  // Handler for opening profile folder
  const handleOpenFolder = useCallback(async () => {
    console.log("[ProfileDetailViewV2] handleOpenFolder called for:", currentProfile.name);
    const openPromise = ProfileService.openProfileFolder(currentProfile.id);
    toast.promise(openPromise, {
      loading: `Opening folder for '${currentProfile.name}'...`,
      success: `Successfully opened folder for '${currentProfile.name}'!`,
      error: (err) => {
        const message = err instanceof Error ? err.message : String(err.message);
        console.error(`Failed to open folder for ${currentProfile.name}:`, err);
        return `Failed to open folder: ${message}`;
      },
    });
  }, [currentProfile, profile.id]);

  // Handler for duplicating profile
  const handleDuplicateProfile = useCallback(() => {
    console.log("[ProfileDetailViewV2] handleDuplicateProfile called for:", currentProfile.name);
    openDuplicateModal(currentProfile);
  }, [currentProfile, openDuplicateModal]);

  // Handler for opening modpack versions modal
  const handleOpenModpackVersionsModal = useCallback(() => {
    console.log("[ProfileDetailViewV2] handleOpenModpackVersionsModal called for:", currentProfile.name);
    showModal(`modpack-versions-${currentProfile.id}`, (
      <ModpackVersionsModal
        isOpen={true}
        onClose={() => hideModal(`modpack-versions-${currentProfile.id}`)}
        versions={modpackVersions}
        modpackName={currentProfile.name}
        profileId={currentProfile.id}
        onSwitchComplete={async () => {
          // Refresh profile data after modpack switch
          try {
            await fetchProfiles();
            // Force reload the current profile from the updated profiles list
            const updatedProfiles = useProfileStore.getState().profiles;
            const updatedProfile = updatedProfiles.find(p => p.id === currentProfile.id);
            if (updatedProfile) {
              setCurrentProfile(updatedProfile);
              console.log("Profile refreshed after modpack version switch:", updatedProfile.modpack_info);
            } else {
              console.error("Could not find updated profile after switch");
            }
          } catch (err) {
            console.error("Failed to refresh profile data after modpack switch:", err);
          }
        }}
      />
    ));
  }, [currentProfile, showModal, hideModal, modpackVersions, fetchProfiles]);

  // Effect to synchronize the internal currentProfile state with the profile prop
  useEffect(() => {
    setCurrentProfile(profile);
  }, [profile]);

  // Effect to sync activeMainTab with drag drop store for world import functionality
  useEffect(() => {
    setDragDropMainTab(activeMainTab);
    return () => {
      // Clear when component unmounts
      setDragDropMainTab(null);
    };
  }, [activeMainTab, setDragDropMainTab]);

  // Function to refresh modpack versions
  const refreshModpackVersions = useCallback(async () => {
    if (currentProfile.modpack_info) {
      setIsLoadingVersions(true);
      try {
        const versions = await UnifiedService.getModpackVersions(currentProfile.modpack_info.source);
        setModpackVersions(versions);
      } catch (err) {
        console.error("Failed to refresh modpack versions:", err);
        setModpackVersions(null);
      } finally {
        setIsLoadingVersions(false);
      }
    } else {
      setModpackVersions(null);
    }
  }, [currentProfile.modpack_info]);

  // Effect to load modpack versions when profile has modpack info
  useEffect(() => {
    refreshModpackVersions();
  }, [refreshModpackVersions]);



  // Close this menu if another context menu opens globally
  useEffect(() => {
    if (openContextMenuId && openContextMenuId !== contextMenuId && isContextMenuOpen) {
      setIsContextMenuOpen(false);
    }
  }, [openContextMenuId, contextMenuId, isContextMenuOpen]);



  // Get mod loader icon
  const getModLoaderIcon = () => {
    switch (profile.loader) {
      case "fabric":
        return "/icons/fabric.png";
      case "forge":
        return "/icons/forge.png";
      case "quilt":
        return "/icons/quilt.png";
      case "neoforge":
        return "/icons/neoforge.png";
      default:
        return "/icons/minecraft.png";
    }
  };

  // Main tabs configuration
  const mainTabs: GroupTab[] = [
    { id: "content", name: "Content", count: 0, icon: "solar:widget-bold" },
    { id: "worlds", name: "Worlds", count: 0, icon: "solar:planet-bold" },
    { id: "screenshots", name: "Screenshots", count: 0, icon: "solar:camera-bold" },
    { id: "logs", name: "Logs", count: 0, icon: "solar:code-bold" },
  ];



  // Action buttons configuration similar to ProfilesTabV2
  const actionButtons: ActionButton[] = [
    {
      id: "back",
      label: "BACK",
      icon: "solar:arrow-left-bold",
      tooltip: "Back to profiles",
      onClick: () => onClose(),
    },
    {
      id: "play",
      label: isLaunching ? "STOP" : "PLAY",
      icon: isLaunching ? "solar:stop-bold" : "solar:play-bold",
      tooltip: isLaunching ? "Stop playing" : "Start playing",
      onClick: handleLaunch,
    },
    {
      id: "settings",
      label: "SETTINGS",
      icon: "solar:settings-bold",
      tooltip: profile.is_standard_version ? "Java Settings" : "Edit profile",
      onClick: () => onEdit(),
    },
    {
      id: "more",
      label: null,
      icon: "solar:menu-dots-bold",
      tooltip: "More options",
      onClick: (event?: React.MouseEvent<HTMLButtonElement>) => {
        event?.preventDefault();
        event?.stopPropagation();

        // Close any other open context menus first
        if (openContextMenuId && openContextMenuId !== contextMenuId) {
          setOpenContextMenuId(null);
        }

        // Simple toggle like CustomDropdown
        const newState = !isContextMenuOpen;
        setIsContextMenuOpen(newState);
        setOpenContextMenuId(newState ? contextMenuId : null);

        // Calculate position when opening
        if (!isContextMenuOpen && event?.currentTarget) {
          const buttonRect = event.currentTarget.getBoundingClientRect();
          const containerRect = event.currentTarget.closest('.relative')?.getBoundingClientRect();

          if (containerRect) {
            setContextMenuPosition({
              x: buttonRect.right - containerRect.left - 200, // Position menu to the left of the button
              y: buttonRect.bottom - containerRect.top + 4,   // Position below the button
            });
          }
        }
      },
    },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 relative">
      <div className={`flex-1 flex flex-col min-h-0 ${activeMainTab === "logs" ? "" : "overflow-hidden"}`}>
        {/* Profile Header Section */}
        <div className="mb-1 flex-shrink-0">
          <div className="flex items-center gap-4 mb-4">
            {/* Profile Icon */}
            <div className="relative">
              <ProfileIconV2
                profile={currentProfile}
                size="lg"
                className="w-16 h-16"
              />
            </div>

            {/* Profile Details */}
            <div className="flex flex-col gap-2 flex-1">
              {/* Profile Name with Account Indicator */}
              <div className="flex items-center gap-2">
                <h1 className="font-minecraft-ten text-2xl text-white normal-case">
                  <span dangerouslySetInnerHTML={{ __html: parseMotdToHtml(profile.name || profile.id) }} />
                </h1>
                
                {/* Preferred Account Indicator next to title */}
                {preferredAccount && (
                  <Tooltip content={`Launch with: ${preferredAccount.username}`}>
                    <div className="flex items-center gap-1 text-white/60">
                      {preferredAccountAvatarUrl && (
                        <img
                          src={preferredAccountAvatarUrl}
                          alt={preferredAccount.username}
                          className="w-5 h-5 rounded-sm pixelated flex-shrink-0"
                          style={{ imageRendering: 'pixelated' }}
                          onError={(e) => {
                            e.currentTarget.src = 'https://crafatar.com/avatars/8667ba71b85a4004af54457a9734eed7?overlay=true';
                          }}
                        />
                      )}
                      <span className="truncate max-w-[100px] text-base lowercase">{preferredAccount.username}</span>
                    </div>
                  </Tooltip>
                )}
              </div>



              {/* Game Info / Launch Status */}
              <div className="text-sm font-minecraft-ten">
                {isLaunching && statusMessage ? (
                  /* Launch Status Message */
                  <div className="text-white/60 flex items-center gap-2 min-w-0 max-w-lg">
                    <span className="truncate text-sm font-minecraft-ten" title={statusMessage}>
                      {statusMessage}
                    </span>
                  </div>
                ) : (
                  /* Normal Game Info */
                  <div className="flex items-center gap-3">
                    {/* Minecraft Version */}
                    <div className="text-white/70 flex items-center gap-2">
                      <img
                        src="/icons/minecraft.png"
                        alt="Minecraft"
                        className="w-4 h-4 object-contain"
                      />
                      <span>{profile.game_version}</span>
                    </div>

                    {/* Loader Info (if not vanilla) */}
                    {profile.loader && profile.loader !== "vanilla" && (
                      <>
                        <div className="w-px h-4 bg-white/30"></div>
                        <div className="text-white/60 flex items-center gap-2">
                          <img
                            src={getModLoaderIcon()}
                            alt={profile.loader}
                            className="w-4 h-4 object-contain"
                            onError={(e) => {
                              e.currentTarget.src = "/icons/minecraft.png";
                            }}
                          />
                          <span className="capitalize">{profile.loader}</span>
                          {profile.loader_version && (
                            <span className="text-white/50">
                              {profile.loader_version}
                            </span>
                          )}
                        </div>
                      </>
                    )}

                    {/* Profile Group (if exists) */}
                    {profile.group && (
                      <>
                        <div className="w-px h-4 bg-white/30"></div>
                        <div className="text-white/50 flex items-center gap-1">
                          <Icon icon="solar:folder-bold" className="w-3 h-3" />
                          <span className="uppercase text-xs tracking-wide">
                            {profile.group}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons - Right side of the header row */}
            <div className="flex items-center gap-3 relative">
              <ActionButtons
                actions={actionButtons.filter(btn => btn.id !== 'back')}
                buttonRefs={{ more: moreButtonRef }}
              />

              {/* Settings Context Menu - Inside the header section */}
              <SettingsContextMenu
                profile={currentProfile}
                isOpen={isContextMenuOpen}
                position={contextMenuPosition}
                items={contextMenuItems}
                onClose={() => {
                  setIsContextMenuOpen(false);
                  setOpenContextMenuId(null);
                }}
                triggerButtonRef={moreButtonRef}
              />

              {/* Delete Confirmation Modal */}
              <ConfirmDeleteDialog
                isOpen={isDeleteModalOpen}
                itemName={currentProfile.name}
                onClose={handleCancelDelete}
                onConfirm={handleConfirmDelete}
                isDeleting={isDeleting}
                title="Delete Profile"
                message={
                  <p className="text-white/80 font-minecraft-ten">
                    Are you sure you want to permanently delete the profile{" "}
                    <strong className="text-white">"{currentProfile.name}"</strong>?
                    <br />
                    This action cannot be undone.
                  </p>
                }
              />


            </div>
          </div>

          {/* Divider under profile info */}
          <div className="h-px w-full bg-white/10 mt-4 mb-4" />

          {/* Main Tabs Navigation - under divider */}
          <div className="flex-shrink-0">
            <GroupTabs
              groups={mainTabs}
              activeGroup={activeMainTab}
              onGroupChange={(tabId) => setActiveMainTab(tabId as MainTabType)}
              showAddButton={false}
            />
          </div>
        </div>



        {/* Content Area */}
        <div className="flex-1 min-h-0 flex flex-col">
          {activeMainTab === "content" && (
            <div className="flex flex-1 min-h-0">
              {/* Content Display Area */}
              <div className="flex-1 min-w-0 mr-6 flex flex-col min-h-0">
                {activeContentTab === "mods" && (
                  <LocalContentTabV2<LocalContentItem>
                    profile={currentProfile}
                    contentType="Mod"
                    getDisplayFileName={getGenericDisplayFileName}
                    itemTypeName="mod"
                    itemTypeNamePlural="mods"
                    addContentButtonText="Add Mods"
                    emptyStateIconOverride="solar:bolt-bold-duotone"
                    onRefreshRequired={handleRefresh}
                    onBrowseContentRequest={handleBrowseContent}
                  />
                )}

                {activeContentTab === "resourcepacks" && (
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

                {activeContentTab === "datapacks" && (
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

                {activeContentTab === "shaderpacks" && (
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

                {activeContentTab === "nrc" && (
                  <LocalContentTabV2<LocalContentItem>
                    profile={currentProfile}
                    contentType="NoRiskMod"
                    getDisplayFileName={getGenericDisplayFileName}
                    itemTypeName="NoRisk Mod"
                    itemTypeNamePlural="NoRisk Mods"
                    addContentButtonText="Add NoRisk Mods"
                    emptyStateIconOverride="solar:shield-check-bold-duotone"
                    onRefreshRequired={async () => {
                      // Force refresh of profile data when NoRisk pack changes
                      try {
                        // Fetch the updated profile from the store
                        await fetchProfiles();
                        // Force re-render by creating a new object reference
                        setCurrentProfile(prev => ({ ...prev }));
                      } catch (err) {
                        console.error("Failed to refresh profile data:", err);
                      }
                      handleRefresh();
                    }}
                    onBrowseContentRequest={handleBrowseContent}
                  />
                )}
              </div>

              {/* Content Type Sidebar */}
              <div className="w-64 flex-shrink-0 border-l border-white/10 pl-4">
                <div className="space-y-2">
                  <div className="text-white/70 text-sm font-minecraft-ten uppercase tracking-wide mb-4">
                    Content Types
                  </div>

                  <button
                    onClick={() => setActiveContentTab("mods")}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded transition-colors text-left ${activeContentTab === "mods"
                        ? "bg-white/10 text-white border border-white/20"
                        : "text-white/60 hover:text-white hover:bg-white/5"
                      }`}
                  >
                    <Icon icon="solar:widget-bold" className="w-5 h-5 flex-shrink-0" />
                    <span className="font-minecraft-ten text-sm uppercase tracking-wide">
                      Mods
                    </span>
                  </button>

                  <button
                    onClick={() => setActiveContentTab("resourcepacks")}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded transition-colors text-left ${activeContentTab === "resourcepacks"
                        ? "bg-white/10 text-white border border-white/20"
                        : "text-white/60 hover:text-white hover:bg-white/5"
                      }`}
                  >
                    <Icon icon="solar:palette-bold" className="w-5 h-5 flex-shrink-0" />
                    <span className="font-minecraft-ten text-sm uppercase tracking-wide">
                      Resource Packs
                    </span>
                  </button>

                  <button
                    onClick={() => setActiveContentTab("datapacks")}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded transition-colors text-left ${activeContentTab === "datapacks"
                        ? "bg-white/10 text-white border border-white/20"
                        : "text-white/60 hover:text-white hover:bg-white/5"
                      }`}
                  >
                    <Icon icon="solar:database-bold" className="w-5 h-5 flex-shrink-0" />
                    <span className="font-minecraft-ten text-sm uppercase tracking-wide">
                      Data Packs
                    </span>
                  </button>

                  <button
                    onClick={() => setActiveContentTab("shaderpacks")}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded transition-colors text-left ${activeContentTab === "shaderpacks"
                        ? "bg-white/10 text-white border border-white/20"
                        : "text-white/60 hover:text-white hover:bg-white/5"
                      }`}
                  >
                    <Icon icon="solar:sun-bold" className="w-5 h-5 flex-shrink-0" />
                    <span className="font-minecraft-ten text-sm uppercase tracking-wide">
                      Shader Packs
                    </span>
                  </button>

                  <button
                    onClick={() => setActiveContentTab("nrc")}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded transition-colors text-left ${activeContentTab === "nrc"
                        ? "bg-white/10 text-white border border-white/20"
                        : "text-white/60 hover:text-white hover:bg-white/5"
                      }`}
                  >
                    <Icon icon="solar:shield-check-bold" className="w-5 h-5 flex-shrink-0" />
                    <span className="font-minecraft-ten text-sm uppercase tracking-wide">
                      NoRisk Client
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeMainTab === "worlds" && (
            <div className="h-full">
              <WorldsTab
                profile={currentProfile}
                onRefresh={handleRefresh}
                isActive={true}
                onLaunchRequest={handleLaunchRequest}
              />
            </div>
          )}

          {activeMainTab === "screenshots" && (
            <div className="h-full">
              <ScreenshotsTab
                profile={currentProfile}
                isActive={true}
                onOpenScreenshotModal={(screenshot) => {
                  // TODO: Implement screenshot modal using global modal system
                  console.log("Open screenshot modal for:", screenshot);
                }}
              />
            </div>
          )}

          {activeMainTab === "logs" && (
            <div className="h-full">
              <LogsTab
                profile={currentProfile}
                isActive={true}
                onRefresh={handleRefresh}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
