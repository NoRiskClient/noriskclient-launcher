"use client";

import React, { useCallback, useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { SkinViewer } from "./SkinViewer";
import { MainLaunchButton } from "./MainLaunchButton";
import { useThemeStore } from "../../store/useThemeStore";
import { useSkinStore } from "../../store/useSkinStore";
import { MinecraftSkinService } from "../../services/minecraft-skin-service";
import type { GetStarlightSkinRenderPayload } from "../../types/localSkin";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Icon } from "@iconify/react";
import { ServerLaunchCard } from "./ServerLaunchCard";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { StaticTooltip } from "../ui/Tooltip";
import { toast } from "sonner";
import { isWorldCupEventActive } from "../../data/worldcup-event";
import type { LaunchOverrides } from "../../services/process-service";
import { Dropdown } from "../ui/dropdown/Dropdown";

const DEFAULT_FALLBACK_SKIN_URL = "/skins/default_steve_full.png"; // Defined constant for fallback URL
const STARLIGHT_RENDER_TYPES = [
  "default",
  "crouching",
  "criss_cross",
  "ultimate",
  "relaxing",
  "pointing",
  "sleeping",
  "mojavatar",
  "reading",
] as const;

function getRandomRenderType() {
  const randomIndex = Math.floor(Math.random() * STARLIGHT_RENDER_TYPES.length);
  return STARLIGHT_RENDER_TYPES[randomIndex];
}

const FEATURED_SERVER = {
  address: "hugosmp.net",
  name: "HugoSMP.net",
  profileId: null as string | null,
};

const WM_PUBLIC_VIEWING = {
  address: FEATURED_SERVER.address,
  iconSrc: "/worldcup/football.png",
  gameVersion: "1.21.11",
  pack: "norisk-prod",
  loader: "fabric",
};

interface PlayerActionsDisplayProps {
  playerName: string | null | undefined;
  launchButtonDefaultVersion: string;
  onLaunchVersionChange: (versionId: string) => void;
  launchButtonVersions: Array<{
    id: string;
    label: string;
    icon?: string;
    isCustom?: boolean;
    profileId: string;
  }>;
  className?: string;
  displayMode?: "playerName" | "logo";
}

function FeaturedPromoIcon({
  src,
  alt,
  size = "md",
}: {
  src: string;
  alt: string;
  size?: "sm" | "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const sizeClass =
    size === "lg" ? "w-7 h-7" : size === "sm" ? "w-4 h-4" : "w-5 h-5";

  if (failed) {
    return (
      <Icon icon="noto:soccer-ball" className={cn(sizeClass, "shrink-0")} />
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={cn(sizeClass, "shrink-0 object-contain")}
      style={{ imageRendering: "pixelated" }}
      onError={() => setFailed(true)}
    />
  );
}

export function PlayerActionsDisplay({
  playerName,
  launchButtonDefaultVersion,
  onLaunchVersionChange,
  launchButtonVersions,
  className,
  displayMode = "playerName",
}: PlayerActionsDisplayProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const uiStylePreset = useThemeStore((state) => state.uiStylePreset);
  const featureMode = useThemeStore((state) => state.featureMode);
  const setFeatureMode = useThemeStore((state) => state.setFeatureMode);
  const isFullRiskStyle = uiStylePreset === "fullrisk";
  const [resolvedSkinUrl, setResolvedSkinUrl] = useState<string>(
    DEFAULT_FALLBACK_SKIN_URL,
  );
  const [currentRenderType, setCurrentRenderType] = useState<string>("default");
  const [isPoseDropdownOpen, setIsPoseDropdownOpen] = useState(false);
  const skinRevision = useSkinStore((state) => state.skinRevision);
  const navigate = useNavigate();
  const [poseTriggerRef, setPoseTriggerRef] =
    useState<HTMLButtonElement | null>(null);

  const isLoadingProfiles = launchButtonVersions.length === 0;

  const getFeaturedServerProfileId = (): string | null => {
    if (FEATURED_SERVER.profileId) {
      return FEATURED_SERVER.profileId;
    }

    // Option A: Use currently selected profile from MainLaunchButton
    const selectedVersion = launchButtonVersions.find(
      (v) => v.id === launchButtonDefaultVersion,
    );
    return selectedVersion?.profileId || null;
  };

  const featuredServerProfileId = getFeaturedServerProfileId();

  const handleFeaturedServerMods = () => {
    if (!featuredServerProfileId) {
      toast.error(t("profiles.errors.no_profile_selected"));
      return;
    }

    navigate(`/profilesv2/${featuredServerProfileId}`);
  };

  const handleTopToggle = () => {
    setFeatureMode(!featureMode);
  };

  const fetchAndSetSkin = useCallback(
    async (requestedRenderType?: string) => {
      if (!playerName) {
        console.log(
          "[PlayerActionsDisplay] No player name, using default fallback skin.",
        );
        setCurrentRenderType("default");
        setResolvedSkinUrl(DEFAULT_FALLBACK_SKIN_URL);
        return;
      }

      const renderType = requestedRenderType || "default";

      try {
        const payload: GetStarlightSkinRenderPayload = {
          player_name: playerName,
          render_type: renderType,
          render_view: "full",
        };
        setCurrentRenderType(renderType);
        const localPath =
          await MinecraftSkinService.getStarlightSkinRender(payload);
        if (localPath) {
          setResolvedSkinUrl(convertFileSrc(localPath));
        } else {
          setResolvedSkinUrl(DEFAULT_FALLBACK_SKIN_URL);
        }
      } catch (error) {
        console.error(
          "[PlayerActionsDisplay] Failed to fetch starlight skin render:",
          error,
        );
        try {
          const activeSkin = await MinecraftSkinService.getActiveSkin().catch(
            () => null,
          );
          const payload: GetStarlightSkinRenderPayload = {
            player_name: playerName,
            render_type: "default",
            render_view: "full",
            base64_skin_data: activeSkin?.base64_data ?? null,
          };
          const localPath =
            await MinecraftSkinService.getStarlightSkinRender(payload);
          if (localPath) {
            setResolvedSkinUrl(convertFileSrc(localPath));
          } else {
            setResolvedSkinUrl(DEFAULT_FALLBACK_SKIN_URL);
          }
        } catch (error) {
          console.error(
            "[PlayerActionsDisplay] Failed to fetch starlight skin render:",
            error,
          );
          setResolvedSkinUrl(DEFAULT_FALLBACK_SKIN_URL);
        }
      }
    },
    [playerName, skinRevision],
  );

  useEffect(() => {
    fetchAndSetSkin(getRandomRenderType());
  }, [fetchAndSetSkin]);

  const dropShadowX = "2px";
  const dropShadowY = "4px";
  const dropShadowBlur = "6px";
  const commonDropShadowStyle = `drop-shadow(${dropShadowX} ${dropShadowY} ${dropShadowBlur} ${accentColor.value})`;

  const skinViewerDisplayHeight = isFullRiskStyle ? 470 : 450;
  const skinViewerMaxDisplayWidth = isFullRiskStyle ? 238 : 225;

  const skinViewerStyles: React.CSSProperties = {
    filter: "drop-shadow(5px 10px 5px rgba(0,0,0,0.75))",
    WebkitBoxReflect:
      "below 0px linear-gradient(to bottom, transparent, rgba(0,0,0,0.05))",
    height: `${skinViewerDisplayHeight}px`,
    width: "auto",
    maxWidth: `${skinViewerMaxDisplayWidth}px`,
  };

  const selectedVersionLabel = launchButtonVersions.find(
    (v) => v.id === launchButtonDefaultVersion,
  )?.label;
  const activeProfileName = selectedVersionLabel || playerName || "default";

  const worldCupActive = isWorldCupEventActive();
  const featuredLaunchOverrides: LaunchOverrides | undefined = worldCupActive
    ? {
        game_version: WM_PUBLIC_VIEWING.gameVersion,
        loader: WM_PUBLIC_VIEWING.loader,
        pack: WM_PUBLIC_VIEWING.pack,
      }
    : undefined;

  return (
    <div
      className={cn(
        isFullRiskStyle
          ? "relative flex flex-col items-center justify-center h-full"
          : "flex flex-col items-center",
        className,
      )}
    >
      {isFullRiskStyle && (
        <div className="pointer-events-none absolute inset-y-10 inset-x-0 fullrisk-outline opacity-95" />
      )}

      {displayMode === "logo" ? (
        <img
          src="norisk_logo_color.png"
          alt="NoRisk Logo"
          className="h-48 sm:h-56 md:h-64 mb-[-80px] sm:mb-[-100px] md:mb-[-120px] relative z-0"
          style={{
            imageRendering: "pixelated",
            filter: commonDropShadowStyle,
          }}
        />
      ) : isFullRiskStyle ? (
        <div className="absolute top-10 left-12 right-12 z-20">
          <div className="max-w-[560px]">
            <h2 className="fullrisk-title font-minecraft text-[96px] leading-[0.9] font-normal break-words">
              {activeProfileName.toLowerCase()}
            </h2>
            <button
              type="button"
              ref={setPoseTriggerRef}
              onClick={() => setIsPoseDropdownOpen((value) => !value)}
              className="font-minecraft-ten text-[10px] uppercase tracking-[0.24em] text-white/55 mt-3 cursor-pointer hover:text-white/80 transition-colors"
            >
              pose: {currentRenderType}
            </button>
            {poseTriggerRef && (
              <Dropdown
                isOpen={isPoseDropdownOpen}
                onClose={() => setIsPoseDropdownOpen(false)}
                triggerRef={{ current: poseTriggerRef }}
                width={220}
                className="max-h-[320px] overflow-y-auto custom-scrollbar"
              >
                <div className="py-2">
                  {STARLIGHT_RENDER_TYPES.map((renderType) => (
                    <button
                      key={renderType}
                      type="button"
                      onClick={() => {
                        setIsPoseDropdownOpen(false);
                        fetchAndSetSkin(renderType);
                      }}
                      className={cn(
                        "w-full px-4 py-2 text-left font-minecraft-ten text-[10px] uppercase tracking-[0.2em] transition-colors",
                        currentRenderType === renderType
                          ? "text-white bg-white/12"
                          : "text-white/70 hover:text-white hover:bg-white/8",
                      )}
                    >
                      {renderType.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </Dropdown>
            )}
          </div>
        </div>
      ) : (
        <h2 className="font-minecraft text-6xl text-center text-white mb-2 lowercase font-normal">
          {playerName || "no account"}
        </h2>
      )}

      <div
        className={cn(
          isFullRiskStyle
            ? "relative w-full h-full flex flex-col items-center justify-end"
            : "relative w-full max-w-[500px] flex flex-col items-center",
          displayMode === "logo" && "z-10",
        )}
      >
        {isFullRiskStyle && (
          <div className="absolute bottom-[27rem] left-1/2 z-20 -translate-x-1/2 text-center pointer-events-none">
            <p className="font-minecraft text-[38px] text-white/90 lowercase text-shadow-sm">
              {playerName ? playerName.toLowerCase() : "no account"}
            </p>
          </div>
        )}
        <SkinViewer
          skinUrl={resolvedSkinUrl}
          playerName={playerName?.toString()}
          width={skinViewerMaxDisplayWidth}
          height={skinViewerDisplayHeight}
          className="bg-transparent flex-shrink-0"
          style={{
            ...skinViewerStyles,
            ...(isFullRiskStyle ? { transform: "translateY(12px)" } : {}),
          }}
        />

        {!isLoadingProfiles && (
          <>
            {/* Featured Server Toggle - above the launch button */}
            <div
              className={cn(
                "absolute left-0 right-0 flex justify-center px-4 z-30 transition-all duration-300",
                isFullRiskStyle
                  ? featureMode
                    ? "bottom-44"
                    : "bottom-36"
                  : featureMode
                    ? "bottom-40"
                    : "bottom-32",
              )}
            >
              {!featureMode && worldCupActive ? (
                <StaticTooltip
                  content={t("wm.tooltip", {
                    version: WM_PUBLIC_VIEWING.gameVersion,
                    server: FEATURED_SERVER.address,
                  })}
                  delay={200}
                >
                  <button
                    onClick={handleTopToggle}
                    className="font-minecraft text-2xl lowercase text-white/70 hover:text-white transition-all duration-200 cursor-pointer bg-transparent border-none p-0 whitespace-nowrap text-shadow"
                  >
                    <span className="flex items-center gap-2">
                      <FeaturedPromoIcon
                        src={WM_PUBLIC_VIEWING.iconSrc}
                        alt=""
                        size="md"
                      />
                      {t("wm.public_viewing").toLowerCase()}
                    </span>
                  </button>
                </StaticTooltip>
              ) : (
                <button
                  onClick={handleTopToggle}
                  className="font-minecraft text-2xl lowercase text-white/70 hover:text-white transition-all duration-200 cursor-pointer bg-transparent border-none p-0 whitespace-nowrap text-shadow"
                  title={
                    featureMode
                      ? t("wm.switch_to_main")
                      : t("wm.switch_to_hugo", { server: FEATURED_SERVER.name })
                  }
                >
                  {featureMode
                    ? t("wm.switch_to_main")
                    : FEATURED_SERVER.name.toLowerCase()}
                </button>
              )}
            </div>
            <div
              className={
                isFullRiskStyle
                  ? "absolute bottom-5 left-0 right-0 flex justify-center px-4"
                  : "absolute bottom-8 left-0 right-0 flex justify-center px-4"
              }
            >
              {featureMode ? (
                <ServerLaunchCard
                  serverAddress={FEATURED_SERVER.address}
                  serverName={FEATURED_SERVER.name}
                  profileId={featuredServerProfileId}
                  onMods={handleFeaturedServerMods}
                  launchOverrides={featuredLaunchOverrides}
                />
              ) : (
                <div className="max-w-xs sm:max-w-sm">
                  <MainLaunchButton
                    defaultVersion={launchButtonDefaultVersion}
                    onVersionChange={onLaunchVersionChange}
                    versions={launchButtonVersions}
                    selectedVersionLabel={selectedVersionLabel}
                    mainButtonWidth={isFullRiskStyle ? "w-[420px]" : "w-80"}
                    maxWidth={isFullRiskStyle ? "520px" : "400px"}
                    mainButtonHeight={isFullRiskStyle ? "h-[88px]" : "h-20"}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
