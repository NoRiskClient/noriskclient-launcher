"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import type { Profile } from "../../types/profile";
import { useProfileStore } from "../../store/profile-store";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useThemeStore } from "../../store/useThemeStore";
import { toast } from "react-hot-toast";
import { ProfileContextMenu } from "./ProfileContextMenu";
import * as ProfileService from "../../services/profile-service";
import { LaunchButton } from "../ui/buttons/LaunchButton";
import { Card } from "../ui/Card";
import { useNavigate } from "react-router-dom";
import { ProfileIcon } from "./ProfileIcon";
import { convertFileSrc } from "@tauri-apps/api/core";
import { cn } from "../../lib/utils";
import { useLaunchStateStore } from "../../store/launch-state-store";

interface ProfileCardProps {
  profile: Profile;
  onEdit: () => void;
  onClick: () => void;
  onProfileCloned: () => void;
  onDelete: (profileId: string, profileName: string) => void;
  onShouldExport: (profile: Profile) => void;
  interactionMode?: "launch" | "settings";
  onSettingsNavigation?: () => void;
}

export function ProfileCard({
  profile,
  onEdit,
  onClick,
  onProfileCloned,
  onDelete,
  onShouldExport,
  interactionMode = "launch",
  onSettingsNavigation,
}: ProfileCardProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const navigate = useNavigate();

  const [isCloning, setIsCloning] = useState(false);
  const [isCardHovered, setIsCardHovered] = useState(false);
  const [resolvedBackgroundImageUrl, setResolvedBackgroundImageUrl] = useState<
    string | null
  >(null);
  const [isBgLoading, setIsBgLoading] = useState(false);

  const { confirm, confirmDialog } = useConfirmDialog();
  const cardRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({
    x: 0,
    y: 0,
  });

  const { getProfileState, initializeProfile } = useLaunchStateStore();
  const { isButtonLaunching, buttonStatusMessage } = getProfileState(profile.id);

  useEffect(() => {
    initializeProfile(profile.id);
  }, [profile.id, initializeProfile]);

  const handleSettingsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/profiles/${profile.id}`);
    if (onSettingsNavigation) {
      setTimeout(() => {
        onSettingsNavigation();
      }, 150);
    }
  };

  useEffect(() => {
    const resolveBackgroundImage = async () => {
      if (profile.background?.source) {
        setIsBgLoading(true);
        setResolvedBackgroundImageUrl(null);
        try {
          const resolvedPathOrUrl = await ProfileService.resolveImagePath(
            profile.background.source,
            profile.id,
          );

          if (
            profile.background.source.type === "absolutePath" ||
            profile.background.source.type === "relativePath" ||
            profile.background.source.type === "relativeProfile"
          ) {
            if (resolvedPathOrUrl) {
              const assetUrl = await convertFileSrc(resolvedPathOrUrl);
              setResolvedBackgroundImageUrl(assetUrl + "?v=" + Date.now());
            } else {
              setResolvedBackgroundImageUrl(null);
            }
          } else {
            setResolvedBackgroundImageUrl(resolvedPathOrUrl);
          }
        } catch (error) {
          console.error(
            "Error resolving profile background image source:",
            profile.background.source,
            error,
          );
          setResolvedBackgroundImageUrl(null);
        } finally {
          setIsBgLoading(false);
        }
      } else {
        setResolvedBackgroundImageUrl(null);
        setIsBgLoading(false);
      }
    };

    resolveBackgroundImage();
  }, [profile.background, profile.id]);

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

  const handleClone = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!profile.id) {
      toast.error("Profile ID is missing, cannot clone.");
      return;
    }
    try {
      const newName = await confirm({
        title: "clone profile",
        inputLabel: "Profile name",
        inputPlaceholder: "Enter profile name",
        inputInitialValue: `${profile.name} (Copy)`,
        inputRequired: true,
        confirmText: "CLONE",
        type: "input",
        fullscreen: true,
      });

      if (newName && typeof newName === "string") {
        setIsCloning(true);
        const clonePromise = useProfileStore
          .getState()
          .copyProfile(profile.id, newName, null, true);

        toast
          .promise(clonePromise, {
            loading: `Cloning profile '${profile.name}'...`,
            success: () => {
              onProfileCloned();
              return `Profile '${newName}' cloned successfully!`;
            },
            error: (err) =>
              `Failed to clone profile: ${err instanceof Error ? err.message : String(err.message)}`,
          })
          .finally(() => {
            setIsCloning(false);
          });
      }
    } catch (err) {
      console.error("Error in clone setup or dialog: ", err);
      toast.error("Could not initiate cloning process.");
      setIsCloning(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await confirm({
      title: "delete profile",
      message: `Are you sure you want to delete profile "${profile.name}"? This action cannot be undone.`,
      confirmText: "DELETE",
      cancelText: "CANCEL",
      type: "danger",
      fullscreen: true,
    });

    if (confirmed) {
      onDelete(profile.id, profile.name);
    }
  };

  const handleOpenFolder = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const openPromise = ProfileService.openProfileFolder(profile.id);

    toast.promise(openPromise, {
      loading: `Opening folder for '${profile.name}'...`,
      success: `Successfully opened folder for '${profile.name}'!`,
      error: (err) => {
        const message = err instanceof Error ? err.message : String(err.message);
        if (
          message.toLowerCase().includes("not found") ||
          message.toLowerCase().includes("does not exist")
        ) {
          return `Profile folder for '${profile.name}' does not exist yet. Launch the profile to create it.`;
        }
        return `Failed to open folder: ${message}`;
      },
    });
  };

  const handleDuplicateFromContextMenu = () => {
    const mockEvent = {
      stopPropagation: () => {},
    } as React.MouseEvent;
    handleClone(mockEvent);
  };

  const handleDeleteFromContextMenu = () => {
    const mockEvent = {
      stopPropagation: () => {},
    } as React.MouseEvent;
    handleDelete(mockEvent);
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenuPosition({ x: event.clientX, y: event.clientY });
    setContextMenuVisible(true);
  };

  const closeContextMenu = () => {
    setContextMenuVisible(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        contextMenuVisible &&
        contextMenuRef.current &&
        !contextMenuRef.current.contains(event.target as Node)
      ) {
        closeContextMenu();
      }
    };

    if (contextMenuVisible) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [contextMenuVisible]);

  const handleExportFromContextMenu = () => {
    if (profile) {
      onShouldExport(profile);
    }
  };

  const handleRepairFromContextMenu = async () => {
    if (!profile?.id) {
      toast.error("Profile ID is missing, cannot repair.");
      return;
    }

    const repairPromise = ProfileService.repairProfile(profile.id);

    toast.promise(repairPromise, {
      loading: `Repairing profile '${profile.name}'...`,
      success: `Profile '${profile.name}' repaired successfully!`,
      error: (err) => {
        const message = err instanceof Error ? err.message : String(err.message);
        return `Failed to repair profile: ${message}`;
      },
    });
  };

  const handleDivClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (contextMenuVisible) {
      return;
    }

    const target = e.target as HTMLElement;
    const isInteractiveElementClick =
      target.closest("button") ||
      target.closest("a") ||
      (contextMenuRef.current && contextMenuRef.current.contains(target));

    if (!isInteractiveElementClick) {
      onClick();
    }
  };

  return (
    <>
      <div
        style={{
          opacity: isCloning ? 0.7 : 1,
        }}
        className="transition-opacity duration-150 ease-in-out"
        onMouseEnter={() => setIsCardHovered(true)}
        onMouseLeave={() => setIsCardHovered(false)}
      >
        <Card
          ref={cardRef}
          onClick={handleDivClick}
          onContextMenu={handleContextMenu}
          className={cn(
            "p-4 flex flex-col gap-3 relative overflow-hidden",
            "transition-all duration-300 ease-out hover:scale-[1.02]",
            isCloning && "pointer-events-none",
          )}
          variant="flat"
          withAnimation={false}
        >
          {/* Background image overlay */}
          {resolvedBackgroundImageUrl && !isBgLoading && (
            <div
              className="absolute inset-0 z-0 opacity-20"
              style={{
                backgroundImage: `url("${resolvedBackgroundImageUrl}")`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(2px)",
              }}
            />
          )}

          {/* Content */}
          <div className="flex items-center gap-4 relative z-10 w-full">
            <div
              className="relative w-20 h-20 flex-shrink-0 rounded-lg border-2 flex items-center justify-center group overflow-hidden"
              style={{
                backgroundColor: `${accentColor.value}20`,
                borderColor: `${accentColor.value}60`,
              }}
            >
              <ProfileIcon
                profileId={profile.id}
                banner={profile.banner}
                profileName={profile.name}
                accentColor={accentColor.value}
                onSuccessfulUpdate={() => {}}
                isEditable={false}
                variant="bare"
                className="w-full h-full"
                placeholderIcon="ph:package-duotone"
                iconClassName="w-10 h-10"
              />
              {!isCloning &&
                (isButtonLaunching || isCardHovered) && (
                  <div
                    className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity duration-150 cursor-pointer"
                    onClick={
                      interactionMode === "settings"
                        ? handleSettingsClick
                        : undefined
                    }
                    aria-label={
                      interactionMode === "settings"
                        ? `Settings for ${profile.name}`
                        : undefined
                    }
                    role={interactionMode === "settings" ? "button" : undefined}
                    tabIndex={interactionMode === "settings" ? 0 : undefined}
                    onKeyDown={
                      interactionMode === "settings"
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ")
                              handleSettingsClick(e as any);
                          }
                        : undefined
                    }
                  >
                    {interactionMode === "launch" ? (
                      <LaunchButton
                        id={profile.id}
                        name={profile.name}
                        isIconOnly={true}
                        disabled={isCloning}
                        forceDisplaySpinner={isButtonLaunching}
                        className="text-white"
                      />
                    ) : (
                      <Icon
                        icon="solar:settings-bold"
                        className="w-12 h-12 text-white hover:text-white/80 transition-colors"
                      />
                    )}
                  </div>
                )}
            </div>

            <div className="flex-grow min-w-0 mr-auto pr-2 max-w-[calc(100%-80px)]">
              <h3
                className="font-minecraft-ten text-white text-lg whitespace-nowrap overflow-hidden text-ellipsis max-w-full normal-case"
                title={profile.name}
              >
                {profile.name}
              </h3>
              <div
                className="flex items-center gap-2 text-white/60 mt-1 font-minecraft-ten text-xs whitespace-nowrap overflow-hidden text-ellipsis h-5 max-w-full"
                title={
                  isCloning
                    ? "Cloning profile..."
                    : isButtonLaunching
                      ? buttonStatusMessage || "Starting..."
                      : `${profile.loader || "Vanilla"} - ${profile.game_version}`
                }
              >
                {isCloning ? (
                  <span className="opacity-70">Cloning profile...</span>
                ) : isButtonLaunching ? (
                  <span className="opacity-70">
                    {buttonStatusMessage || "Starting..."}
                  </span>
                ) : (
                  <>
                    <img
                      src={getModLoaderIcon() || "/placeholder.svg"}
                      alt={profile.loader || "Vanilla"}
                      className="w-4 h-4 object-contain"
                    />
                    <span>
                      {profile.loader || "Vanilla"} {profile.game_version}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {confirmDialog}
      <ProfileContextMenu
        ref={contextMenuRef}
        profile={profile}
        visible={contextMenuVisible}
        x={contextMenuPosition.x}
        y={contextMenuPosition.y}
        onClose={closeContextMenu}
        onDelete={handleDeleteFromContextMenu}
        onDuplicate={handleDuplicateFromContextMenu}
        onOpenFolder={handleOpenFolder}
        onExport={handleExportFromContextMenu}
        onOpenSettings={onEdit}
        onRepair={handleRepairFromContextMenu}
      />
    </>
  );
}
