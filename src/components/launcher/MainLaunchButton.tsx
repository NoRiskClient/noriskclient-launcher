"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { LaunchState } from "../../store/launch-state-store";
import { Button } from "../ui/buttons/Button";
import { IconButton } from "../ui/buttons/IconButton";
import { RolloutIndicator } from "./RolloutIndicator";

import { useThemeStore } from "../../store/useThemeStore";
import { useVersionSelectionStore } from "../../store/version-selection-store";
import { useProfileLaunch } from "../../hooks/useProfileLaunch";
import { useProfileStore } from "../../store/profile-store";
import { ProfileSelectionModal } from "./ProfileSelectionModal";
import { resolveImagePath } from "../../services/profile-service";
import { convertFileSrc } from "@tauri-apps/api/core";

interface Version {
  id: string;
  label: string;
  icon?: string;
  isCustom?: boolean;
  profileId?: string;
}

interface MainLaunchButtonProps {
  versions?: Version[];
  defaultVersion?: string;
  className?: string;
  onVersionChange?: (version: string) => void;
  maxWidth?: string;
  selectedVersionLabel?: string;
  mainButtonWidth?: string;
  mainButtonHeight?: string;
}

export function MainLaunchButton({
  defaultVersion,
  className,
  onVersionChange,
  versions,
  maxWidth = "300px",
  selectedVersionLabel,
  mainButtonWidth,
  mainButtonHeight,
}: MainLaunchButtonProps) {
  const { t } = useTranslation();
  const [transientSuccessActive, setTransientSuccessActive] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [profileBackdropUrl, setProfileBackdropUrl] = useState<string | null>(
    null,
  );
  const [profileIconUrl, setProfileIconUrl] = useState<string | null>(null);
  const accentColor = useThemeStore((state) => state.accentColor);
  const uiStylePreset = useThemeStore((state) => state.uiStylePreset);
  const isFullRiskStyle = uiStylePreset === "fullrisk";

  const { selectedVersion, setSelectedVersion } = useVersionSelectionStore();
  const { profiles } = useProfileStore();

  const {
    handleLaunch: hookHandleLaunch,
    isLaunching,
    statusMessage,
    launchState,
  } = useProfileLaunch({
    profileId: selectedVersion,
    onLaunchSuccess: () => {
      setTransientSuccessActive(true);
      setTimeout(() => {
        setTransientSuccessActive(false);
      }, 3000);
    },
    onLaunchError: (error: string) => {
      console.error("Launch error:", error);
    },
  });

  const isButtonLaunching = isLaunching;
  const buttonStatusMessage = statusMessage;

  useEffect(() => {
    const currentStoreVersion = selectedVersion;
    const storeVersionIsValidInProps = versions?.some(
      (v) => v.id === currentStoreVersion,
    );

    if (defaultVersion) {
      if (
        !storeVersionIsValidInProps ||
        currentStoreVersion !== defaultVersion
      ) {
        const defaultVersionPropIsValidInProps = versions?.some(
          (v) => v.id === defaultVersion,
        );
        if (defaultVersionPropIsValidInProps) {
          setSelectedVersion(defaultVersion);
        } else if (versions && versions.length > 0) {
          setSelectedVersion(versions[0].id);
        } else {
          setSelectedVersion("");
        }
      }
    } else {
      if (!storeVersionIsValidInProps) {
        if (versions && versions.length > 0) {
          setSelectedVersion(versions[0].id);
        } else {
          setSelectedVersion("");
        }
      }
    }
  }, [defaultVersion, versions, selectedVersion, setSelectedVersion]);

  useEffect(() => {
    const selectedProfile =
      profiles.find((profile) => profile.id === selectedVersion) ?? null;
    const backgroundSource =
      selectedProfile?.background?.source || selectedProfile?.banner?.source;
    const iconSource = selectedProfile?.banner?.source ?? null;

    if (!selectedProfile) {
      setProfileBackdropUrl(null);
      setProfileIconUrl(null);
      return;
    }

    let isMounted = true;

    const resolveSource = async (source: typeof backgroundSource) => {
      if (!source) return null;
      try {
        const resolvedPath = await resolveImagePath(source, selectedProfile.id);
        if (!isMounted || !resolvedPath) return null;

        return ["absolutePath", "relativePath", "relativeProfile"].includes(
          source.type,
        )
          ? convertFileSrc(resolvedPath)
          : resolvedPath;
      } catch (error) {
        return null;
      }
    };

    const loadAssets = async () => {
      const [resolvedBackground, resolvedIcon] = await Promise.all([
        resolveSource(backgroundSource),
        resolveSource(iconSource),
      ]);

      if (!isMounted) return;
      setProfileBackdropUrl(resolvedBackground);
      setProfileIconUrl(resolvedIcon);
    };

    loadAssets();

    return () => {
      isMounted = false;
    };
  }, [profiles, selectedVersion]);

  const handleLaunch = async () => {
    if (!selectedVersion) return;
    await hookHandleLaunch();
  };

  const handleVersionChange = (version: string) => {
    if (isButtonLaunching) return;
    if (onVersionChange) {
      onVersionChange(version);
    }
  };

  const handleOpenModal = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isButtonLaunching) return;
    setIsProfileModalOpen(true);
  };

  const renderLaunchButtonContent = () => {
    const actionText = isButtonLaunching ? "Stop" : "Launch";

    let statusSubText: string | null | undefined = null;
    let statusColorClass = "opacity-85";

    if (
      transientSuccessActive &&
      buttonStatusMessage === t("launch.starting")
    ) {
      statusSubText = buttonStatusMessage;
      statusColorClass = "text-green-400";
    } else if (isButtonLaunching) {
      statusSubText = buttonStatusMessage || "Launching...";
      statusColorClass = buttonStatusMessage
        ? "opacity-90 text-white"
        : "opacity-75";
    } else if (buttonStatusMessage && launchState === LaunchState.ERROR) {
      statusSubText = buttonStatusMessage;
      statusColorClass = "text-red-400";
    } else if (buttonStatusMessage) {
      statusSubText = buttonStatusMessage;
      statusColorClass = "opacity-85";
    }

    const displaySubText = statusSubText || selectedVersionLabel;
    return (
      <div
        className={
          isFullRiskStyle
            ? "w-full flex flex-col items-center justify-center leading-none -mt-3"
            : "w-full flex flex-col items-center justify-center leading-none -mt-4"
        }
      >
        <span
          className={
            isFullRiskStyle
              ? "text-[52px] text-center lowercase text-shadow"
              : "text-5xl text-center lowercase"
          }
        >
          {actionText}
        </span>
        {displaySubText && (
          <span
            className={cn(
              isFullRiskStyle
                ? "text-[10px] font-minecraft-ten tracking-[0.2em] mt-1 text-center uppercase whitespace-nowrap overflow-hidden text-ellipsis"
                : "text-xs font-minecraft-ten tracking-normal -mt-1 text-center normal-case whitespace-nowrap overflow-hidden text-ellipsis",
              isButtonLaunching ? "max-w-64" : "",
              statusColorClass,
            )}
            style={isButtonLaunching ? { maxWidth: "16rem" } : undefined}
            title={
              typeof displaySubText === "string" ? displaySubText : undefined
            }
          >
            {displaySubText}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      <div
        className={cn("relative flex flex-col justify-center", className)}
        style={{ maxWidth }}
      >
        {!isFullRiskStyle ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center relative">
              <Button
                onClick={handleLaunch}
                disabled={
                  !selectedVersion ||
                  (versions && versions.length === 0 && !selectedVersion)
                }
                size="xl"
                icon={undefined}
                variant={isButtonLaunching ? "destructive" : "3d"}
                className={cn("flex-1 rounded-r-none", mainButtonWidth)}
                heightClassName={mainButtonHeight}
              >
                {renderLaunchButtonContent()}
              </Button>
              <IconButton
                onClick={handleOpenModal}
                disabled={
                  isButtonLaunching || !versions || versions.length === 0
                }
                icon={<Icon icon="solar:alt-arrow-down-bold" />}
                variant={isButtonLaunching ? "destructive" : "3d"}
                size="xl"
                className={cn("rounded-l-none w-16", mainButtonHeight)}
                aria-label={t("launcher.select_version")}
              />
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "relative overflow-hidden rounded-[20px] border",
              isFullRiskStyle ? "min-w-[320px]" : "min-w-[280px]",
              mainButtonWidth,
              mainButtonHeight,
            )}
            style={{
              borderColor: isButtonLaunching
                ? "rgba(239,68,68,0.72)"
                : isFullRiskStyle
                  ? `${accentColor.value}d9`
                  : "rgba(255,255,255,0.12)",
              backgroundColor: isButtonLaunching
                ? "rgba(85, 18, 18, 0.9)"
                : isFullRiskStyle
                  ? accentColor.value
                  : "rgba(10, 18, 28, 0.88)",
              boxShadow: isButtonLaunching
                ? "0 18px 36px rgba(127,29,29,0.42), inset 0 1px 0 rgba(255,255,255,0.08)"
                : isFullRiskStyle
                  ? `0 8px 0 rgba(0,0,0,0.32), 0 16px 34px ${accentColor.shadowValue}, inset 0 1px 0 rgba(255,255,255,0.1)`
                  : "0 18px 40px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.08)",
            }}
          >
            {profileBackdropUrl ? (
              <div
                className="absolute inset-0 bg-cover bg-center opacity-60"
                style={{ backgroundImage: `url(${profileBackdropUrl})` }}
              />
            ) : null}
            <div
              className="absolute inset-0"
              style={{
                background: isButtonLaunching
                  ? "linear-gradient(90deg, rgba(71,14,14,0.96) 0%, rgba(95,22,22,0.88) 56%, rgba(95,22,22,0.42) 100%)"
                  : isFullRiskStyle
                    ? `linear-gradient(90deg, ${accentColor.value}f5 0%, ${accentColor.hoverValue}eb 58%, ${accentColor.hoverValue}57 100%)`
                    : "linear-gradient(90deg, rgba(9,17,28,0.98) 0%, rgba(9,31,53,0.9) 56%, rgba(9,31,53,0.22) 100%)",
              }}
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.12),transparent_48%)]" />

            <div className="relative z-10 flex h-full">
              <button
                type="button"
                onClick={handleLaunch}
                disabled={
                  !selectedVersion ||
                  (versions && versions.length === 0 && !selectedVersion)
                }
                className="flex flex-1 items-center justify-center gap-4 px-6 text-white transition-all duration-200 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {profileIconUrl ? (
                  <span className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-md border-2 border-white/35 bg-black/20 flex-shrink-0">
                    <img
                      src={profileIconUrl}
                      alt="Profile Icon"
                      className="h-full w-full object-cover image-pixelated"
                    />
                  </span>
                ) : null}
                {renderLaunchButtonContent()}
              </button>

              <button
                type="button"
                onClick={handleOpenModal}
                disabled={
                  isButtonLaunching || !versions || versions.length === 0
                }
                className="flex w-[84px] items-center justify-center border-l border-white/12 text-white/90 transition-all duration-200 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={t("launcher.select_version")}
              >
                <Icon icon="solar:alt-arrow-down-bold" width="28" height="28" />
              </button>
            </div>
          </div>
        )}
      </div>
      <ProfileSelectionModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        onVersionChange={(versionId) => {
          handleVersionChange(versionId);
          setIsProfileModalOpen(false);
        }}
        title={t("launcher.select_version")}
      />
    </>
  );
}
