"use client";

import type React from "react";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import type { Profile, ResolvedLoaderVersion } from "../../types/profile";
import { ProfileIconV2 } from "./ProfileIconV2";
import { toast } from "react-hot-toast";
import { ProfileActionButtons, type ProfileActionButton } from "../ui/ProfileActionButtons";
import { SettingsContextMenu, type ContextMenuItem } from "../ui/SettingsContextMenu";
import { Icon } from "@iconify/react";
import { useProfileSettingsStore } from "../../store/profile-settings-store";
import { useProfileDuplicateStore } from "../../store/profile-duplicate-store";
import { useThemeStore } from "../../store/useThemeStore";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { ExportProfileModal } from "./ExportProfileModal";
import { useProfileLaunch } from "../../hooks/useProfileLaunch.tsx";
import { Tooltip } from "../ui/Tooltip";
import UnifiedService from "../../services/unified-service";
import { useProfileStore } from "../../store/profile-store";

// Custom JSX component for tooltip content
function StandardVersionTooltipContent() {
  return (
    <div className="space-y-3">
      {/* Main explanation */}
      <div className="text-left">
        <div className="text-sm leading-relaxed text-white">
          This version is provided and updated by NRC.
        </div>
      </div>

      {/* Tip section */}
      <div className="flex items-start gap-2">
        <Icon icon="solar:lightbulb-bold" className="text-yellow-400 text-base flex-shrink-0" />
        <div className="text-gray-300 text-xs leading-snug italic">
          <span className="text-yellow-300 font-medium">Tip:</span> Create your own profiles for full customization.
        </div>
      </div>
    </div>
  );
}

interface ProfileCardV2Props {
  profile: Profile;
  onPlay?: (profile: Profile) => void;
  onSettings?: (profile: Profile) => void;
  onMods?: (profile: Profile) => void;
  onDelete?: (profileId: string, profileName: string) => void;
  onOpenFolder?: (profile: Profile) => void;
  layoutMode?: "list" | "grid" | "compact";
  variant?: "default" | "3d";
}

export function ProfileCardV2({
  profile,
  onPlay,
  onSettings,
  onMods,
  onDelete,
  onOpenFolder,
  layoutMode = "list",
  variant = "default",
}: ProfileCardV2Props) {
  const navigate = useNavigate();
  const [isHovered, setIsHovered] = useState(false);
  const [modsButtonHovered, setModsButtonHovered] = useState(false);
  const accentColor = useThemeStore((state) => state.accentColor);
  const { openContextMenuId, setOpenContextMenuId } = useThemeStore();
  
  // Settings context menu state
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const contextMenuId = `profile-${profile.id}`;
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  // Modpack versions state for conditional rendering
  const [modpackVersions, setModpackVersions] = useState(null);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  
  // Profile settings store
  const { openModal } = useProfileSettingsStore();
  
  // Profile duplicate store
  const { openModal: openDuplicateModal } = useProfileDuplicateStore();

  // Global modal system
  const { showModal, hideModal } = useGlobalModal();

  // Resolved loader version state
  const [resolvedLoaderVersion, setResolvedLoaderVersion] = useState<ResolvedLoaderVersion | null>(null);

  // Settings context menu items
  const contextMenuItems: ContextMenuItem[] = [
    {
      id: "edit",
      label: "Edit Profile",
      icon: "solar:settings-bold",
      onClick: (profile) => {
        console.log("Edit Profile clicked for:", profile.name);
        openModal(profile);
      },
    },
    {
      id: "duplicate",
      label: "Duplicate",
      icon: "solar:copy-bold",
      onClick: (profile) => {
        console.log("Duplicate Profile clicked for:", profile.name);
        openDuplicateModal(profile);
      },
    },
    {
      id: "export",
      label: "Export",
      icon: "solar:download-bold",
      onClick: (profile) => {
        showModal(`export-profile-${profile.id}`, (
          <ExportProfileModal
            profile={profile}
            isOpen={true}
            onClose={() => hideModal(`export-profile-${profile.id}`)}
          />
        ));
      },
    },
    {
      id: "open-folder",
      label: "Open Folder",
      icon: "solar:folder-bold",
      onClick: (profile) => {
        if (onOpenFolder) {
          onOpenFolder(profile);
        } else {
          toast.success(`📁 Opening folder for ${profile.name}!`);
          console.log("Opening folder for profile:", profile.name);
        }
      },
    },
    // Show modpack versions only if modpack info exists and versions are loaded
    ...(profile.modpack_info?.source && modpackVersions ? [{
      id: "switch_modpack",
      label: "Modpack Versions",
      icon: "solar:refresh-circle-bold",
      onClick: (profile) => {
        console.log("Switch modpack version for profile:", profile.name);
        if (profile.modpack_info?.source) {
          // Import ModpackVersionsModal dynamically to avoid circular imports
          import("../modals/ModpackVersionsModal").then(({ ModpackVersionsModal }) => {
            showModal(`modpack-versions-${profile.id}`, (
              <ModpackVersionsModal
                isOpen={true}
                onClose={() => hideModal(`modpack-versions-${profile.id}`)}
                versions={modpackVersions}
                modpackName={profile.name}
                profileId={profile.id}
                onSwitchComplete={async () => {
                  console.log("Modpack version switched successfully for:", profile.name);
                  // Refresh profiles to ensure the profile prop is updated
                  try {
                    const { fetchProfiles } = useProfileStore.getState();
                    await fetchProfiles();
                  } catch (err) {
                    console.error("Failed to refresh profiles after modpack switch:", err);
                  }
                }}
              />
            ));
          });
        }
      },
    }] : []),
    {
      id: "delete",
      label: "Delete",
      icon: "solar:trash-bin-trash-bold",
      destructive: true,
      separator: true, // Trennstrich vor Delete
      disabled: profile.is_standard_version,
      onClick: (profile) => {
        if (onDelete) {
          onDelete(profile.id, profile.name);
        } else {
          toast.error(`🗑️ Delete ${profile.name}!`);
          console.log("Deleting profile:", profile.name);
        }
      },
    },
  ];

  // Profile launch hook
  const { isLaunching, statusMessage, handleLaunch } = useProfileLaunch({
    profileId: profile.id,
    onLaunchSuccess: () => {
      console.log("Profile launched successfully:", profile.name);
    },
    onLaunchError: (error) => {
      console.error("Profile launch error:", error);
    },
    skipLastPlayedUpdate: variant === "3d", // Skip for featured profiles in 3D mode
  });



  // Close this menu if another context menu opens globally
  useEffect(() => {
    if (openContextMenuId && openContextMenuId !== contextMenuId && isContextMenuOpen) {
      setIsContextMenuOpen(false);
    }
  }, [openContextMenuId, contextMenuId, isContextMenuOpen]);

  // Load modpack versions when profile has modpack info
  useEffect(() => {
    if (profile.modpack_info?.source) {
      setIsLoadingVersions(true);
      UnifiedService.getModpackVersions(profile.modpack_info.source)
        .then(setModpackVersions)
        .catch(err => {
          console.error("Failed to load modpack versions:", err);
          setModpackVersions(null);
        })
        .finally(() => setIsLoadingVersions(false));
    } else {
      setModpackVersions(null);
    }
  }, [profile.modpack_info?.source]);





  // Fetch resolved loader version
  useEffect(() => {
    async function fetchResolvedLoaderVersion() {
      if (!profile.game_version || profile.loader === "vanilla") {
        setResolvedLoaderVersion(null);
        return;
      }

      try {
        // TODO: Implement loader version resolution
        setResolvedLoaderVersion(null);
      } catch (err) {
        console.error("Failed to resolve loader version:", err);
        setResolvedLoaderVersion(null);
      }
    }

    fetchResolvedLoaderVersion();
  }, [profile.id, profile.game_version, profile.loader, profile.loader_version]);





  // Get mod loader icon - reused from ProfileCard.tsx
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

  // Get 3D styling for variant (matching Button.tsx exactly)
  const get3DStyling = () => {
    if (variant !== "3d") return {};

    const colors = {
      main: accentColor.value,
      light: accentColor.hoverValue || accentColor.value,
      dark: accentColor.value,
    };

    const shadowDepth = "short";

    const backgroundColor = isHovered ? `${colors.main}50` : `${colors.main}30`;
    const borderColor = isHovered ? colors.light : `${colors.main}80`;
    const borderBottomColor = isHovered ? colors.light : colors.dark;

    const part1Y = shadowDepth === "short" ? "4px" : "8px";
    const part2Y = shadowDepth === "short" ? "6px" : "10px";
    const part2Blur = shadowDepth === "short" ? "10px" : "15px";
    const boxShadow = `0 ${part1Y} 0 rgba(0,0,0,0.3), 0 ${part2Y} ${part2Blur} rgba(0,0,0,0.35), inset 0 1px 0 ${colors.light}40, inset 0 0 0 1px ${colors.main}20`;

    return {
      backgroundColor,
      border: "2px solid",
      borderBottom: "4px solid",
      borderColor,
      borderBottomColor,
      boxShadow,
      transform: isHovered ? "scale(1.02)" : "scale(1)",
      filter: isHovered ? "brightness(1.1)" : "brightness(1)",
      transition: "all 0.2s ease",
    };
  };

  // Get 3D styling for small buttons (settings/mods buttons)
  const get3DButtonStyling = (isHovered: boolean = false) => {
    if (variant !== "3d") return {};

    const colors = {
      main: accentColor.value,
      light: accentColor.hoverValue || accentColor.value,
      dark: accentColor.value,
    };

    const backgroundColor = isHovered ? `${colors.main}40` : `${colors.main}25`;
    const borderColor = isHovered ? colors.light : `${colors.main}70`;
    const borderBottomColor = isHovered ? colors.light : colors.dark;

    const boxShadow = isHovered
      ? `0 2px 0 rgba(0,0,0,0.4), 0 4px 8px rgba(0,0,0,0.3), inset 0 1px 0 ${colors.light}50, inset 0 0 0 1px ${colors.main}30`
      : `0 2px 0 rgba(0,0,0,0.3), 0 3px 6px rgba(0,0,0,0.25), inset 0 1px 0 ${colors.light}30, inset 0 0 0 1px ${colors.main}20`;

    return {
      backgroundColor,
      border: "1px solid",
      borderBottom: "2px solid",
      borderColor,
      borderBottomColor,
      boxShadow,
      color: "#ffffff",
      transform: isHovered ? "scale(1.05)" : "scale(1)",
      filter: isHovered ? "brightness(1.1)" : "brightness(1)",
      transition: "all 0.2s ease",
    };
  };

  // Format last played date
  const formatLastPlayed = (lastPlayed: string | null): string => {
    if (!lastPlayed) return "Never played";
    
    const date = new Date(lastPlayed);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMinutes / 60);
    const diffInDays = Math.floor(diffInHours / 24);
    const diffInWeeks = Math.floor(diffInDays / 7);
    const diffInMonths = Math.floor(diffInDays / 30);
    const diffInYears = Math.floor(diffInDays / 365);
    
    if (diffInMinutes < 1) return "Just now";
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInDays < 7) return `${diffInDays}d ago`;
    if (diffInWeeks < 4) return `${diffInWeeks}w ago`;
    if (diffInMonths < 12) return `${diffInMonths}mo ago`;
    
    return `${diffInYears}y ago`;
  };



  // Action button configuration
  const actionButtons: ProfileActionButton[] = [
    {
      id: "play",
      label: isLaunching ? "STOP" : "PLAY",
      icon: isLaunching ? "solar:stop-bold" : "solar:play-bold",
      variant: isLaunching ? "destructive" : "primary",
      tooltip: isLaunching ? "Launch stoppen" : "Minecraft spielen!",
      onClick: (profile, e) => {
        if (onPlay) {
          onPlay(profile);
        } else {
          handleLaunch();
        }
      },
    },
    {
      id: "mods",
      label: "MODS",
      icon: "solar:box-bold",
      variant: "secondary",
      tooltip: "Mods verwalten",
      onClick: (profile, e) => {
        if (onMods) {
          onMods(profile);
        } else {
          toast.success(`📦 Managing mods for ${profile.name}!`);
          console.log("Managing mods for profile:", profile.name);
        }
      },
    },
    {
      id: "settings",
      label: "SETTINGS",
      icon: "solar:settings-bold",
      variant: "icon-only",
      tooltip: "Profile Options",
             onClick: (profile, e) => {
         e.preventDefault();
         e.stopPropagation();
         
         // Close any other open context menus first
         if (openContextMenuId && openContextMenuId !== contextMenuId) {
           setOpenContextMenuId(null);
         }
         
         // Simple toggle like CustomDropdown
         const newState = !isContextMenuOpen;
         setIsContextMenuOpen(newState);
         setOpenContextMenuId(newState ? contextMenuId : null);
         
         // Calculate position when opening
         if (!isContextMenuOpen) {
           const buttonRect = e.currentTarget.getBoundingClientRect();
           const cardRect = e.currentTarget.closest('.relative')?.getBoundingClientRect();
           
           if (cardRect) {
             setContextMenuPosition({
               x: buttonRect.right - cardRect.left - 200, // Position menu to the left of the button
               y: buttonRect.bottom - cardRect.top + 4,   // Position below the button
             });
           }
         }
       },
    },
  ];

    // Grid layout (more compact, similar to ProfileCard.tsx)
  if (layoutMode === "grid" || layoutMode === "compact") {
    const isCompact = layoutMode === "compact";
    const iconSize = isCompact ? 16 : 20; // Smaller icons for compact mode
    const padding = isCompact ? "p-3" : "p-4"; // Less padding for compact mode
    const gap = isCompact ? "gap-2" : "gap-3"; // Smaller gaps for compact mode
    
    return (
      <div
        className={`relative flex flex-col ${gap} ${padding} rounded-lg ${variant === "3d" ? "backdrop-blur-md" : "bg-black/20 border border-white/10 hover:border-white/20"} transition-all duration-200 cursor-pointer`}
        style={variant === "3d" ? get3DStyling() : {}}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={(e) => {
          // Don't trigger if clicking on action buttons or play overlay
          const target = e.target as Element;
          if (e.target === e.currentTarget || (!target.closest('button') && !target.closest('.play-overlay'))) {
            if (variant === "3d") {
              // In 3D mode, launch the profile when clicking the card
              if (onPlay) {
                onPlay(profile);
              } else {
                handleLaunch();
              }
            } else {
              // Default behavior: manage mods
              if (onMods) {
                onMods(profile);
              } else {
                toast.success(`📦 Managing mods for ${profile.name}!`);
                console.log("Managing mods for profile:", profile.name);
              }
            }
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();

          if (openContextMenuId && openContextMenuId !== contextMenuId) {
            setOpenContextMenuId(null);
          }
          setIsContextMenuOpen(true);
          setOpenContextMenuId(contextMenuId);

          const cardRect = e.currentTarget.getBoundingClientRect();
          setContextMenuPosition({
            x: e.clientX - cardRect.left,
            y: e.clientY - cardRect.top,
          });
        }}
      >
        {/* Standard version badge */}
        {profile.is_standard_version && (
          <div className={`absolute ${isCompact ? 'top-2 left-2' : 'top-3 left-3'} z-20`}>
            <Tooltip content={<StandardVersionTooltipContent />}>
              <div className="flex items-center justify-center w-6 h-6 rounded-full ">
                <Icon icon="solar:star-bold" className="w-4 h-4 text-yellow-400" />
              </div>
            </Tooltip>
          </div>
        )}

        {/* Action buttons - top right */}
        <div className={`absolute ${isCompact ? 'top-2 right-2' : 'top-3 right-3'} z-20 flex flex-col gap-1`}>
          {/* Settings button - hidden in 3D mode */}
          {variant === "default" && (
            <button
            ref={settingsButtonRef}
                         onClick={(e) => {
               e.preventDefault();
               e.stopPropagation();

               // Close any other open context menus first
               if (openContextMenuId && openContextMenuId !== contextMenuId) {
                 setOpenContextMenuId(null);
               }

               // Simple toggle like CustomDropdown
               const newState = !isContextMenuOpen;
               setIsContextMenuOpen(newState);
               setOpenContextMenuId(newState ? contextMenuId : null);

               // Calculate position when opening
               if (!isContextMenuOpen) {
                 const buttonRect = e.currentTarget.getBoundingClientRect();
                 const cardRect = e.currentTarget.closest('.relative')?.getBoundingClientRect();

                 if (cardRect) {
                   setContextMenuPosition({
                     x: buttonRect.right - cardRect.left - 200, // Position menu to the left of the button
                     y: buttonRect.bottom - cardRect.top + 4,   // Position below the button
                   });
                 }
               }
             }}
            className={`${isCompact ? 'w-6 h-6' : 'w-8 h-8'} flex items-center justify-center rounded transition-all duration-200 bg-black/30 hover:bg-black/50 text-white/70 hover:text-white border border-white/10 hover:border-white/20`}
            title="Profile Options"
            data-action="settings"
          >
            <Icon icon="solar:settings-bold" className={isCompact ? 'w-3 h-3' : 'w-4 h-4'} />
          </button>
          )}

          {/* Mods button */}
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onMods) {
                onMods(profile);
              } else {
                // Navigate to specific profile detail view for mod management
                navigate(`/profilesv2/${profile.id}`);
              }
            }}
            className={`${variant === "3d" ? (isCompact ? 'w-auto px-2 h-6' : 'w-auto px-3 h-8') : (isCompact ? 'w-6 h-6' : 'w-8 h-8')} flex items-center justify-center gap-1 rounded transition-all duration-200 ${variant === "3d" ? "" : "bg-black/30 hover:bg-black/50 text-white/70 hover:text-white border border-white/10 hover:border-white/20"}`}
            style={variant === "3d" ? get3DButtonStyling(modsButtonHovered) : {}}
            onMouseEnter={() => setModsButtonHovered(true)}
            onMouseLeave={() => setModsButtonHovered(false)}
            title="Manage Mods"
          >
            <Icon icon="solar:box-bold" className={isCompact ? 'w-3 h-3' : 'w-4 h-4'} />
            {variant === "3d" && (
              <span className={`font-minecraft-ten ${isCompact ? 'text-xs' : 'text-sm'} uppercase`}>MODS</span>
            )}
          </button>
        </div>

        {/* Profile content */}
        <div className={`flex items-center ${isCompact ? 'gap-3' : 'gap-4'} relative z-10 w-full`}>
          <div className={`relative ${isCompact ? 'w-16 h-16' : 'w-20 h-20'} flex-shrink-0 rounded-lg flex items-center justify-center overflow-hidden border-2 transition-all duration-200`}
            style={{
              backgroundColor: isHovered ? `${accentColor.value}20` : 'transparent',
              borderColor: isHovered ? `${accentColor.value}60` : 'transparent',
            }}
          >
            <ProfileIconV2 profile={profile} size={isCompact ? "md" : "lg"} className="w-full h-full" />
            
            {/* Play button overlay - similar to ProfileCard.tsx */}
            {(isLaunching || isHovered) && (
              <div className="play-overlay absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity duration-150 cursor-pointer rounded-lg">
                <button
                  onClick={() => handleLaunch()}
                  className={`${isCompact ? 'w-8 h-8' : 'w-12 h-12'} flex items-center justify-center text-white hover:text-white/80 transition-colors`}
                  disabled={false}
                >
                  {isLaunching ? (
                    <Icon icon="solar:stop-bold" className={isCompact ? 'w-6 h-6' : 'w-8 h-8'} />
                  ) : (
                    <Icon icon="solar:play-bold" className={isCompact ? 'w-6 h-6' : 'w-8 h-8'} />
                  )}
                </button>
              </div>
            )}
          </div>

          <div className={`flex-grow min-w-0 mr-auto pr-2 ${isCompact ? 'max-w-[calc(100%-64px)]' : 'max-w-[calc(100%-80px)]'}`}>
            <h3
              className={`font-minecraft-ten text-white ${isCompact ? 'text-base' : 'text-lg'} whitespace-nowrap overflow-hidden text-ellipsis max-w-full normal-case`}
              style={{ textShadow: '0 2px 4px rgba(0,0,0,0.7)' }}
              title={profile.name}
            >
              {profile.name}
            </h3>
            {isLaunching ? (
              <div
                className="text-white/60 text-xs font-minecraft-ten opacity-70 whitespace-nowrap overflow-hidden text-ellipsis max-w-full"
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
              >
                {statusMessage || "Starting..."}
              </div>
            ) : (
              isCompact ? (
                 // Compact mode: Only MC version + last played
                 <div className="flex items-center gap-1.5 text-xs font-minecraft-ten" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                   {/* Minecraft Version */}
                   <div className="text-white/70 flex items-center gap-0.5">
                     <img
                       src="/icons/minecraft.png"
                       alt="Minecraft"
                       className="w-2.5 h-2.5 object-contain"
                     />
                     <span>{profile.game_version}</span>
                   </div>

                   <div className="w-px h-2.5 bg-white/30"></div>

                   {/* Last Played */}
                   <div className="text-white/50">
                     {formatLastPlayed(profile.last_played)}
                   </div>
                 </div>
               ) : (
                 // Grid mode: Full info display
                 <div className="flex items-center gap-2 text-xs font-minecraft-ten" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
                   {/* Minecraft Version */}
                   <div className="text-white/70 flex items-center gap-1">
                     <img
                       src="/icons/minecraft.png"
                       alt="Minecraft"
                       className="w-3 h-3 object-contain"
                     />
                     <span>{profile.game_version}</span>
                   </div>
                   
                   <div className="w-px h-3 bg-white/30"></div>
                   
                   {/* Loader Version */}
                   <div className="text-white/60 flex items-center gap-1">
                     <img
                       src={getModLoaderIcon()}
                       alt={profile.loader || "Vanilla"}
                       className="w-3 h-3 object-contain"
                     />
                     <span>
                       {profile.loader === "vanilla" 
                         ? "Vanilla" 
                         : `${resolvedLoaderVersion?.version || profile.loader_version || "Unknown"}`
                       }
                     </span>
                   </div>
                   
                   <div className="w-px h-3 bg-white/30"></div>
                   
                   {/* Last Played */}
                   <div className="text-white/50">
                     {formatLastPlayed(profile.last_played)}
                   </div>
                 </div>
               )
            )}
          </div>
        </div>

        {/* Settings Context Menu */}
                 <SettingsContextMenu
           profile={profile}
           isOpen={isContextMenuOpen}
           position={contextMenuPosition}
           items={contextMenuItems}
           onClose={() => {
             setIsContextMenuOpen(false);
             setOpenContextMenuId(null);
           }}
           triggerButtonRef={settingsButtonRef}
         />
      </div>
    );
  }

  // List layout (original layout)
  return (
    <div
      className={`relative flex items-center gap-4 p-3 rounded-lg ${variant === "3d" ? "backdrop-blur-md" : "bg-black/20 border border-white/10 hover:border-white/20"} transition-all duration-200 cursor-pointer`}
      style={variant === "3d" ? get3DStyling() : {}}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={(e) => {
        // Don't trigger if clicking on action buttons
        const target = e.target as Element;
        if (e.target === e.currentTarget || !target.closest('button')) {
          if (variant === "3d") {
            // In 3D mode, launch the profile when clicking the card
            if (onPlay) {
              onPlay(profile);
            } else {
              handleLaunch();
            }
          } else {
            // Default behavior: manage mods
            if (onMods) {
              onMods(profile);
            } else {
              toast.success(`📦 Managing mods for ${profile.name}!`);
              console.log("Managing mods for profile:", profile.name);
            }
          }
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();

        if (openContextMenuId && openContextMenuId !== contextMenuId) {
          setOpenContextMenuId(null);
        }
        setIsContextMenuOpen(true);
        setOpenContextMenuId(contextMenuId);

        const cardRect = e.currentTarget.getBoundingClientRect();
        setContextMenuPosition({
          x: e.clientX - cardRect.left,
          y: e.clientY - cardRect.top,
        });
      }}
    >
      {/* Profile Icon */}
      <div className="relative">
        <ProfileIconV2 profile={profile} size="md" />
        {profile.is_standard_version && (
          <div className="absolute -top-1 -right-1 z-10">
            <Tooltip content={<StandardVersionTooltipContent />}>
              <div className="flex items-center justify-center w-6 h-6 rounded-full ">
                <Icon icon="solar:star-bold" className="w-4 h-4 text-yellow-400" />
              </div>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Profile Info */}
      <div className="flex-1 min-w-0">
        <h3
          className="text-white font-minecraft-ten text-sm whitespace-nowrap overflow-hidden text-ellipsis normal-case mb-1"
          style={{ textShadow: '0 2px 4px rgba(0,0,0,0.7)' }}
          title={profile.name}
        >
          {profile.name}
        </h3>
        
        {isLaunching ? (
          <div
            className="text-white/60 text-xs font-minecraft-ten opacity-70 whitespace-nowrap overflow-hidden text-ellipsis max-w-full"
            style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
          >
            {statusMessage || "Starting..."}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs font-minecraft-ten" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
          {/* Minecraft Version */}
          <div className="text-white/70 flex items-center gap-1">
            <img
              src="/icons/minecraft.png"
              alt="Minecraft"
              className="w-3 h-3 object-contain"
            />
            <span>{profile.game_version}</span>
          </div>
          
          <div className="w-px h-3 bg-white/30"></div>
          
          {/* Loader Version */}
          <div className="text-white/60 flex items-center gap-1">
            <img
              src={getModLoaderIcon()}
              alt={profile.loader || "Vanilla"}
              className="w-3 h-3 object-contain"
            />
            <span>
              {profile.loader === "vanilla" 
                ? "Vanilla" 
                : `${resolvedLoaderVersion?.version || profile.loader_version || "Unknown"}`
              }
            </span>
          </div>
          
          <div className="w-px h-3 bg-white/30"></div>
          
          {/* Last Played */}
          <div className="text-white/50">
            {formatLastPlayed(profile.last_played)}
          </div>
        </div>
        )}
      </div>

      {/* Action Buttons */}
      <ProfileActionButtons
        profile={profile}
        actions={actionButtons}
        useFlexSpacer={true}
        flexSpacerAfterIndex={1}
      />

             {/* Settings Context Menu */}
       <SettingsContextMenu
         profile={profile}
         isOpen={isContextMenuOpen}
         position={contextMenuPosition}
         items={contextMenuItems}
         onClose={() => {
           setIsContextMenuOpen(false);
           setOpenContextMenuId(null);
         }}
         triggerButtonRef={undefined} // List layout doesn't have direct button ref
       />


    </div>
  );
}
