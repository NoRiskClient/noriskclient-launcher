"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "../../../lib/utils";
import type {
  ModrinthSearchHit,
} from "../../../types/modrinth";
import type { UnifiedVersion } from "../../../types/unified";
import type { AccentColor } from "../../../store/useThemeStore";
import type { ContentInstallStatus } from "../../../types/profile";
import { Icon } from "@iconify/react";
import { ActionButton } from "../../ui/ActionButton";
import { TagBadge } from "../../ui/TagBadge";
import { gsap } from "gsap";
import { useIsFirstRender } from "../../../hooks/useIsFirstRender";
import { Tooltip } from "../../ui/Tooltip";

interface ModrinthVersionItemV2Props {
  version: UnifiedVersion;
  project: ModrinthSearchHit;
  versionStatus: ContentInstallStatus | null;
  isInstalling?: boolean;
  isInstallingModpackVersion?: boolean;
  accentColor: AccentColor;
  isHovered: boolean;
  onMouseEnter: (id: string) => void;
  onMouseLeave: () => void;
  onInstallClick: (
    project: ModrinthSearchHit,
    version: UnifiedVersion,
  ) => void;
  onDeleteClick?: (
    profileId: string,
    project: ModrinthSearchHit,
    version: UnifiedVersion,
  ) => void;
  onToggleEnableClick?: (
    profileId: string,
    project: ModrinthSearchHit,
    version: UnifiedVersion,
    newEnabledState: boolean,
    sha1Hash: string,
  ) => void;
  onInstallModpackVersionAsProfileClick?: (
    project: ModrinthSearchHit,
    version: UnifiedVersion,
  ) => void;
  selectedProfileId?: string | null;
  isBlocked?: boolean; // Deprecated, use noRiskStatus instead
  noRiskStatus?: 'blocked' | 'warning' | null;
}

export const ModrinthVersionItemV2 = React.memo<ModrinthVersionItemV2Props>(
  ({
    version,
    project,
    versionStatus,
    isInstalling: externalIsInstalling = false,
    isInstallingModpackVersion = false,
    accentColor,
    isHovered,
    onMouseEnter,
    onMouseLeave,
    onInstallClick,
    onDeleteClick,
    onToggleEnableClick,
    onInstallModpackVersionAsProfileClick,
    selectedProfileId,
    isBlocked = false, // Deprecated
    noRiskStatus = null,
  }) => {
    const isModpack = project.project_type === "modpack";
    const cardRef = useRef<HTMLDivElement>(null);
    const [isCardHovered, setIsCardHovered] = useState(false);
    const [localIsInstalling, setLocalIsInstalling] = useState(false);
    const [installationStartTime, setInstallationStartTime] = useState<number | null>(null);
    const isFirstRender = useIsFirstRender();

    // Use local state or external state
    const isInstalling = localIsInstalling || externalIsInstalling;

    // If external state becomes true and we don't have local state, synchronize
    useEffect(() => {
      if (externalIsInstalling && !localIsInstalling && !installationStartTime) {
        console.log('External state became true, synchronizing local state');
        setLocalIsInstalling(true);
        setInstallationStartTime(Date.now());
      }
    }, [externalIsInstalling, localIsInstalling, installationStartTime]);

    // Keep local state active for at least 3 seconds after installation starts
    useEffect(() => {
      if (localIsInstalling && installationStartTime) {
        const timer = setTimeout(() => {
          console.log('Minimum display time (3s) passed, resetting local state');
          setLocalIsInstalling(false);
          setInstallationStartTime(null);
        }, 3000); // 3 seconds minimum display time

        return () => clearTimeout(timer);
      }
    }, [localIsInstalling, installationStartTime]); // Remove externalIsInstalling from dependencies

    // Reset local state when version changes
    useEffect(() => {
      setLocalIsInstalling(false);
      setInstallationStartTime(null);
    }, [version.id]);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        setLocalIsInstalling(false);
        setInstallationStartTime(null);
      };
    }, []);

    const handleMouseEnterLocal = () => {
      onMouseEnter(version.id);
    };

    const handleMouseLeaveLocal = () => {
      onMouseLeave();
    };

    useEffect(() => {
      // GSAP animation is removed as the style will be more static like GenericList
      // if (cardRef.current) {
      //   if (isFirstRender) return;

      //   if (isCardHovered) { // isCardHovered is also effectively removed for this
      //     gsap.to(cardRef.current, {
      //       backgroundColor: `${accentColor.value}15`,
      //       borderColor: `${accentColor.value}60`,
      //       y: -3,
      //       boxShadow: `0 8px 0 rgba(0,0,0,0.3), 0 10px 15px rgba(0,0,0,0.35), inset 0 1px 0 ${accentColor.value}30, inset 0 0 0 1px ${accentColor.value}15`,
      //       duration: 0.2,
      //       ease: "power2.out",
      //     });
      //   } else {
      //     gsap.to(cardRef.current, {
      //       backgroundColor: `${accentColor.value}08`,
      //       borderColor: `${accentColor.value}30`,
      //       y: 0,
      //       boxShadow: `0 2px 0 rgba(0,0,0,0.1), 0 3px 5px rgba(0,0,0,0.1)`,
      //       duration: 0.2,
      //       ease: "power2.out",
      //     });
      //   }
      // }
    }, [isCardHovered, accentColor, isFirstRender]);

    const handleButtonClick = () => {
    console.log('Button clicked, localIsInstalling:', localIsInstalling, 'externalIsInstalling:', externalIsInstalling);
    if (isInstalling) return;

    // Set local installing state immediately for instant UI feedback
    setLocalIsInstalling(true);
    setInstallationStartTime(Date.now());

    console.log('Started installation at:', Date.now());

    if (isModpack && onInstallModpackVersionAsProfileClick) {
      onInstallModpackVersionAsProfileClick(project, version);
    } else if (!isModpack) {
      onInstallClick(project, version);
    } else {
      console.warn(
        "onInstallModpackVersionAsProfileClick is not defined for modpack version item",
      );
      onInstallClick(project, version);
    }
  };

    const handleDeleteButtonClick = () => {
      if (onDeleteClick && !isModpack && selectedProfileId) {
        onDeleteClick(selectedProfileId, project, version);
      } else {
        console.warn(
          "Delete action called without a selectedProfileId or onDeleteClick handler missing/isModpack",
        );
      }
    };

    const handleToggleEnableButtonClick = () => {
      if (versionStatus?.norisk_pack_item_details?.norisk_mod_identifier) {
        if (onToggleEnableClick && !isModpack && selectedProfileId) {
          onToggleEnableClick(
            selectedProfileId,
            project,
            version,
            !versionStatus.is_enabled,
            "",
          );
        }
        return;
      }

      const primaryFile =
        version.files.find((f) => f.primary) || version.files[0];
      if (
        onToggleEnableClick &&
        !isModpack &&
        selectedProfileId &&
        versionStatus?.is_installed &&
        primaryFile?.hashes?.sha1 &&
        typeof versionStatus.is_enabled === "boolean"
      ) {
        onToggleEnableClick(
          selectedProfileId,
          project,
          version,
          !versionStatus.is_enabled,
          primaryFile.hashes.sha1,
        );
      } else {
        console.warn(
          "Toggle enable action called under invalid conditions or missing data",
          {
            onToggleEnableClick: !!onToggleEnableClick,
            isModpack,
            selectedProfileId: !!selectedProfileId,
            is_installed: versionStatus?.is_installed,
            sha1: primaryFile?.hashes?.sha1,
            is_enabled_type: typeof versionStatus?.is_enabled,
          },
        );
      }
    };

    let buttonText = "Install";
    let buttonVariant: "primary" | "secondary" = "primary";
    let buttonDisabled = false;

    if (project.project_type === "modpack" && isInstallingModpackVersion) {
      buttonText = "Installing...";
      buttonVariant = "secondary";
      buttonDisabled = true;
    } else if (isInstalling) {
      buttonText = "Installing...";
      buttonVariant = "secondary";
      buttonDisabled = true;
    } else if (versionStatus && versionStatus.is_installed) {
      if (versionStatus?.is_included_in_norisk_pack && !isModpack) {
        buttonText = "In Pack";
        buttonVariant = "secondary";
        buttonDisabled = true;
      } else if (versionStatus?.is_installed && !isModpack) {
        buttonText = "Installed";
        buttonDisabled = true;
      } else if (isModpack && !versionStatus?.is_installed) {
        buttonText = "Install";
        buttonVariant = "primary";
        buttonDisabled = false;
      }
    }
    const showInstallBorder =
      selectedProfileId &&
      (versionStatus?.is_installed ||
        versionStatus?.is_included_in_norisk_pack);

    return (
      <div
        ref={cardRef}
        key={version.id}
        onMouseEnter={handleMouseEnterLocal}
        onMouseLeave={handleMouseLeaveLocal}
        className={cn(
          "relative overflow-hidden transition-colors duration-150 rounded-md backdrop-blur-sm",
          "border",
          showInstallBorder &&
            versionStatus?.is_installed &&
            "border-l-green-500 border-l-4",
          showInstallBorder &&
            !versionStatus?.is_installed &&
            versionStatus?.is_included_in_norisk_pack &&
            "border-l-blue-500 border-l-4",
        )}
        style={{
          backgroundColor: `${accentColor.value}08`,
          borderColor: `${accentColor.value}20`,
        }}
      >
        <div className="relative z-10 p-2.5">
          <div className="flex flex-col space-y-2">
            <div className="flex justify-between items-baseline gap-2">
              <div className="flex-shrink min-w-0 flex items-center gap-2">
                {noRiskStatus === 'blocked' && (
                  <Tooltip content="This mod is blocked by NoRisk Client as it is known to cause crashes or severe compatibility issues. Installation is not recommended.">
                    <Icon 
                      icon="solar:danger-triangle-bold" 
                      className="w-4 h-4 text-red-500 flex-shrink-0"
                    />
                  </Tooltip>
                )}
                {noRiskStatus === 'warning' && (
                  <Tooltip content="This version is known to cause crashes or compatibility issues with NoRisk Client. Installation is possible but not recommended.">
                    <Icon 
                      icon="solar:danger-triangle-bold" 
                      className="w-4 h-4 text-yellow-500 flex-shrink-0"
                    />
                  </Tooltip>
                )}
                {/* Fallback for deprecated isBlocked prop */}
                {!noRiskStatus && isBlocked && (
                  <Tooltip content="This mod is blocked by NoRisk Client as it is known to cause crashes or severe compatibility issues. Installation is not recommended.">
                    <Icon 
                      icon="solar:danger-triangle-bold" 
                      className="w-4 h-4 text-red-500 flex-shrink-0"
                    />
                  </Tooltip>
                )}
                <div className="min-w-0">
                  <h5 className="text-gray-100 text-sm font-minecraft-ten normal-case truncate">
                    {version.name}
                  </h5>
                  <p className="text-gray-400 text-xs font-minecraft-ten normal-case truncate">
                    {version.version_number}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2 text-[10px] text-gray-400 font-minecraft-ten flex-shrink-0">
                {" "}
                <span className="flex items-center">
                  <Icon
                    icon="solar:download-minimalistic-bold"
                    className="w-3 h-3 mr-0.5"
                  />
                  {version.downloads.toLocaleString()}
                </span>
                <span className="flex items-center">
                  <Icon
                    icon="solar:calendar-mark-bold"
                    className="w-3 h-3 mr-0.5"
                  />
                  {new Date(version.date_published).toLocaleDateString()}
                </span>
              </div>
            </div>

            <div className="flex justify-between items-center gap-2">
              <div className="flex flex-wrap items-center gap-1 flex-grow min-w-0">
                {selectedProfileId &&
                  versionStatus?.is_installed &&
                  versionStatus?.is_enabled !== false && (
                    <TagBadge variant="success" className="flex-shrink-0">
                      <Icon
                        icon="solar:check-circle-bold"
                        className="w-3 h-3 mr-0.5"
                      />
                      Installed
                    </TagBadge>
                  )}
                {selectedProfileId &&
                  versionStatus?.is_installed &&
                  versionStatus?.is_enabled === false && (
                    <TagBadge variant="inactive" className="flex-shrink-0">
                      <Icon
                        icon="solar:close-circle-bold"
                        className="w-3 h-3 mr-0.5"
                      />
                      Disabled
                    </TagBadge>
                  )}
                {selectedProfileId &&
                  versionStatus?.is_included_in_norisk_pack && (
                    <TagBadge
                      variant={versionStatus?.is_enabled ? "info" : "inactive"}
                      className="flex-shrink-0"
                    >
                      <Icon
                        icon="solar:bolt-circle-bold"
                        className="w-3 h-3 mr-0.5"
                      />
                      In NoRisk Pack
                    </TagBadge>
                  )}
                <TagBadge className="flex-shrink-0">
                  {version.release_type}
                </TagBadge>
                {version.game_versions.length > 0 &&
                  version.game_versions.slice(0, 5).map((gv) => (
                    <TagBadge key={`gv-${version.id}-${gv}`} variant="default">
                      {gv}
                    </TagBadge>
                  ))}
                {version.game_versions.length > 5 && (
                  <TagBadge variant="default">...</TagBadge>
                )}
                {version.loaders.length > 0 &&
                  version.loaders.map((loader) => (
                    <TagBadge
                      key={`loader-${version.id}-${loader}`}
                      variant="default"
                    >
                      {loader}
                    </TagBadge>
                  ))}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {" "}
                {selectedProfileId &&
                  ((versionStatus?.is_installed &&
                    !isModpack &&
                    typeof versionStatus.is_enabled === "boolean" &&
                    onToggleEnableClick) ||
                    (versionStatus?.is_included_in_norisk_pack &&
                      versionStatus?.norisk_pack_item_details &&
                      onToggleEnableClick)) && (
                    <ActionButton
                      onClick={handleToggleEnableButtonClick}
                      size="sm"
                      variant={
                        versionStatus.is_enabled ? "highlight" : "secondary"
                      }
                      label={versionStatus.is_enabled ? "Active" : "Disabled"}
                      className="min-w-[80px]"
                      icon="solar:settings-bold"
                    />
                  )}
                {selectedProfileId &&
                  versionStatus?.is_installed &&
                  !isModpack &&
                  onDeleteClick && (
                    <ActionButton
                      onClick={handleDeleteButtonClick}
                      size="sm"
                      variant="destructive"
                      label="Delete"
                      className="min-w-[80px]"
                      icon="solar:trash-bin-minimalistic-bold"
                    />
                  )}
                {(!selectedProfileId || !versionStatus?.is_installed) && (
                  <ActionButton
                    onClick={handleButtonClick}
                    size="sm"
                    variant={buttonVariant}
                    disabled={buttonDisabled || isInstalling}
                    className="min-w-[80px]"
                    icon={
                      isInstalling || isInstallingModpackVersion 
                        ? "solar:refresh-bold" 
                        : (noRiskStatus === 'blocked' || noRiskStatus === 'warning')
                          ? "solar:danger-triangle-bold"
                          : "solar:download-minimalistic-bold"
                    }
                    iconClassName={(isInstalling || isInstallingModpackVersion) ? "animate-spin-slow" : ""}
                    label={buttonText}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);
