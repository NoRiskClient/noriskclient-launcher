"use client";

import React, { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import { SkinViewer } from './SkinViewer';
import { MainLaunchButton } from './MainLaunchButton';
import { useThemeStore } from '../../store/useThemeStore';
import { useSkinStore } from '../../store/useSkinStore';
import { MinecraftSkinService } from '../../services/minecraft-skin-service';
import type { GetStarlightSkinRenderPayload } from '../../types/localSkin';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Icon } from '@iconify/react';
import { ServerLaunchCard } from './ServerLaunchCard';
import { useProfileLaunch } from '../../hooks/useProfileLaunch';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StaticTooltip } from '../ui/Tooltip';
import { toast } from 'sonner';
import { isWorldCupEventActive } from '../../data/worldcup-event';

const DEFAULT_FALLBACK_SKIN_URL = "/skins/default_steve_full.png";

const FEATURED_SERVER = {
  address: "hugosmp.net",
  name: "HUGOSMP.net",
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
  displayMode?: 'playerName' | 'logo';
}

function FeaturedPromoIcon({ src, alt, size = "md" }: { src: string; alt: string; size?: "sm" | "md" | "lg" }) {
  const [failed, setFailed] = useState(false);
  const sizeClass =
    size === "lg" ? "w-7 h-7" : size === "sm" ? "w-4 h-4" : "w-5 h-5";

  if (failed) {
    return <Icon icon="noto:soccer-ball" className={cn(sizeClass, "shrink-0")} />;
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
  displayMode = 'playerName',
}: PlayerActionsDisplayProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const featureMode = useThemeStore((state) => state.featureMode);
  const setFeatureMode = useThemeStore((state) => state.setFeatureMode);
  const [resolvedSkinUrl, setResolvedSkinUrl] = useState<string>(DEFAULT_FALLBACK_SKIN_URL);
  const skinRevision = useSkinStore((state) => state.skinRevision);
  const navigate = useNavigate();

  const isLoadingProfiles = launchButtonVersions.length === 0;
  const isFeaturedMode = featureMode;

  const getFeaturedServerProfileId = (): string | null => {
    if (FEATURED_SERVER.profileId) {
      return FEATURED_SERVER.profileId;
    }

    const selectedVersion = launchButtonVersions.find(v => v.id === launchButtonDefaultVersion);
    return selectedVersion?.profileId || null;
  };

  const featuredServerProfileId = getFeaturedServerProfileId();

  const {
    isLaunching: isWmLaunching,
    handleQuickPlayLaunch,
  } = useProfileLaunch({
    profileId: featuredServerProfileId || "",
  });

  const handleFeaturedServerMods = () => {
    if (!featuredServerProfileId) {
      toast.error(t('profiles.errors.no_profile_selected'));
      return;
    }

    navigate(`/profilesv2/${featuredServerProfileId}`);
  };

  const handleTopToggle = () => {
    setFeatureMode(!featureMode);
  };

  const handleWmLaunch = () => {
    if (!featuredServerProfileId) {
      toast.error(t('profiles.errors.no_profile_selected'));
      return;
    }

    handleQuickPlayLaunch(
      undefined,
      WM_PUBLIC_VIEWING.address,
      {
        game_version: WM_PUBLIC_VIEWING.gameVersion,
        loader: WM_PUBLIC_VIEWING.loader,
        pack: WM_PUBLIC_VIEWING.pack,
      },
    );
  };

  useEffect(() => {
    const fetchAndSetSkin = async () => {
      if (playerName) {
        try {
          const activeSkin = await MinecraftSkinService.getActiveSkin().catch(() => null);
          const payload: GetStarlightSkinRenderPayload = {
            player_name: playerName,
            render_type: "default",
            render_view: "full",
            base64_skin_data: activeSkin?.base64_data ?? null,
          };
          const localPath = await MinecraftSkinService.getStarlightSkinRender(payload);
          if (localPath) {
            setResolvedSkinUrl(convertFileSrc(localPath));
          } else {
            setResolvedSkinUrl(DEFAULT_FALLBACK_SKIN_URL);
          }
        } catch (error) {
          console.error("[PlayerActionsDisplay] Failed to fetch starlight skin render:", error);
          setResolvedSkinUrl(DEFAULT_FALLBACK_SKIN_URL);
        }
      } else {
        setResolvedSkinUrl(DEFAULT_FALLBACK_SKIN_URL);
      }
    };

    fetchAndSetSkin();
  }, [playerName, skinRevision]);

  const dropShadowX = '2px';
  const dropShadowY = '4px';
  const dropShadowBlur = '6px';
  const commonDropShadowStyle = `drop-shadow(${dropShadowX} ${dropShadowY} ${dropShadowBlur} ${accentColor.value})`;
  
  const skinViewerDisplayHeight = 450;
  const skinViewerMaxDisplayWidth = 225;

  const skinViewerStyles: React.CSSProperties = {
    filter: 'drop-shadow(5px 10px 5px rgba(0,0,0,0.75))',
    WebkitBoxReflect: 'below 0px linear-gradient(to bottom, transparent, rgba(0,0,0,0.05))',
    height: `${skinViewerDisplayHeight}px`,
    width: 'auto',
    maxWidth: `${skinViewerMaxDisplayWidth}px`,
  };

  const selectedVersionLabel = launchButtonVersions.find(v => v.id === launchButtonDefaultVersion)?.label;

  const topToggleLabel = featureMode
    ? t('wm.switch_to_main')
    : FEATURED_SERVER.name.toLowerCase();

  const isWmDisabled = !featuredServerProfileId;
  const showWorldCupPromo = isWorldCupEventActive();

  return (
    <div className={cn("flex flex-col items-center", className)}>

      {displayMode === 'logo' ? (
        <img
          src="norisk_logo_color.png"
          alt="NoRisk Logo"
          className="h-48 sm:h-56 md:h-64 mb-[-80px] sm:mb-[-100px] md:mb-[-120px] relative z-0"
          style={{
            imageRendering: "pixelated",
            filter: commonDropShadowStyle
          }}
        />
      ) : (
        <h2 className="font-minecraft text-6xl text-center text-white mb-2 lowercase font-normal">
          {playerName || "no account"}
        </h2>
      )}

      <div className={cn(
        "relative w-full max-w-[500px] flex flex-col items-center",
        displayMode === 'logo' && "z-10"
      )}>
        <SkinViewer
          skinUrl={resolvedSkinUrl} 
          playerName={playerName?.toString()} 
          width={skinViewerMaxDisplayWidth} 
          height={skinViewerDisplayHeight} 
          className="bg-transparent flex-shrink-0"
          style={skinViewerStyles}
        />

        {!isLoadingProfiles && (
          <div
            className={cn(
              "absolute left-0 right-0 flex flex-col items-center px-4 z-30 transition-all duration-300",
              isFeaturedMode ? "bottom-2" : "bottom-0"
            )}
          >
            <div className="mb-3">
              <button
                onClick={handleTopToggle}
                className="font-minecraft text-2xl lowercase text-white/70 hover:text-white transition-all duration-200 cursor-pointer bg-transparent border-none p-0 whitespace-nowrap text-shadow"
                title={
                  featureMode
                    ? t('wm.switch_to_main')
                    : t('wm.switch_to_hugo', { server: FEATURED_SERVER.name })
                }
              >
                {topToggleLabel}
              </button>
            </div>

            <div className="flex flex-col items-center gap-3">
              {featureMode ? (
                <ServerLaunchCard
                  serverAddress={FEATURED_SERVER.address}
                  serverName={FEATURED_SERVER.name}
                  profileId={featuredServerProfileId}
                  onMods={handleFeaturedServerMods}
                />
              ) : (
                <div className="max-w-xs sm:max-w-sm">
                  <MainLaunchButton
                    defaultVersion={launchButtonDefaultVersion}
                    onVersionChange={onLaunchVersionChange}
                    versions={launchButtonVersions}
                    selectedVersionLabel={selectedVersionLabel}
                    mainButtonWidth="w-80"
                    maxWidth="400px"
                    mainButtonHeight="h-20"
                  />
                </div>
              )}

              {!featureMode && showWorldCupPromo && (
                <StaticTooltip
                  content={t('wm.tooltip', {
                    version: WM_PUBLIC_VIEWING.gameVersion,
                    server: FEATURED_SERVER.address,
                  })}
                  delay={200}
                >
                  <button
                    type="button"
                    onClick={handleWmLaunch}
                    disabled={isWmDisabled || isWmLaunching}
                    className={cn(
                      "group flex items-center gap-3 px-5 py-2.5 rounded-md backdrop-blur-md transition-all duration-200 border hover:scale-[1.02] hover:brightness-110 active:scale-[0.98]",
                      isWmDisabled || isWmLaunching
                        ? "opacity-50 cursor-not-allowed"
                        : "cursor-pointer",
                    )}
                    style={{
                      backgroundColor: isWmLaunching ? '#ef444430' : `${accentColor.value}30`,
                      borderColor: isWmLaunching ? '#ef444480' : `${accentColor.value}80`,
                      boxShadow: `0 3px 0 rgba(0,0,0,0.3), 0 0 12px ${accentColor.value}30`,
                    }}
                  >
                    {isWmLaunching ? (
                      <Icon icon="solar:refresh-bold" className="w-6 h-6 text-white/80 animate-spin shrink-0" />
                    ) : (
                      <FeaturedPromoIcon
                        src={WM_PUBLIC_VIEWING.iconSrc}
                        alt=""
                        size="lg"
                      />
                    )}
                    <span
                      className="font-minecraft text-2xl lowercase text-white/90 tracking-wide group-hover:text-white"
                      style={{
                        textShadow: `1px 1px 0 rgba(0,0,0,0.5), 0 0 8px ${accentColor.value}60`,
                      }}
                    >
                      {isWmLaunching
                        ? t('server.stop').toLowerCase()
                        : t('wm.public_viewing').toLowerCase()}
                    </span>
                  </button>
                </StaticTooltip>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
