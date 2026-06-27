"use client";

import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { SkinViewer } from './SkinViewer';
import { SkinView3DWrapper } from '../common/SkinView3DWrapper';
import { MainLaunchButton } from './MainLaunchButton';
import { useThemeStore } from '../../store/useThemeStore';
import { useSkinStore } from '../../store/useSkinStore';
import { MinecraftSkinService } from '../../services/minecraft-skin-service';
import type { GetStarlightSkinRenderPayload, SkinVariant } from '../../types/localSkin';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Icon } from '@iconify/react';
import { ServerLaunchCard } from './ServerLaunchCard';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StaticTooltip } from '../ui/Tooltip';
import { toast } from 'sonner';
import { isWorldCupEventActive } from '../../data/worldcup-event';
import type { LaunchOverrides } from '../../services/process-service';

const DEFAULT_FALLBACK_SKIN_URL = "/skins/default_steve_full.png";
let hasWarnedAboutSkinRendererFallback = false;

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
  const [fallbackSkinUrl, setFallbackSkinUrl] = useState<string | null>(null);
  const [fallbackSkinVariant, setFallbackSkinVariant] =
    useState<SkinVariant>("classic");
  const skinRevision = useSkinStore((state) => state.skinRevision);
  const skinPreviewRequestIdRef = useRef(0);
  const navigate = useNavigate();

  const isLoadingProfiles = launchButtonVersions.length === 0;

  const getFeaturedServerProfileId = (): string | null => {
    if (FEATURED_SERVER.profileId) {
      return FEATURED_SERVER.profileId;
    }

    const selectedVersion = launchButtonVersions.find(v => v.id === launchButtonDefaultVersion);
    return selectedVersion?.profileId || null;
  };

  const featuredServerProfileId = getFeaturedServerProfileId();

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

  useEffect(() => {
    const requestId = ++skinPreviewRequestIdRef.current;
    const isCurrentRequest = () => requestId === skinPreviewRequestIdRef.current;

    const warnFallbackOnce = () => {
      if (hasWarnedAboutSkinRendererFallback) return;
      hasWarnedAboutSkinRendererFallback = true;
      toast.warning(t("skins.rendererFallback"));
    };

    const fetchAndSetSkin = async () => {
      if (!playerName) {
        setResolvedSkinUrl(DEFAULT_FALLBACK_SKIN_URL);
        setFallbackSkinUrl(null);
        return;
      }

      const activeSkin = await MinecraftSkinService.getActiveSkin().catch(
        () => null,
      );
      if (!isCurrentRequest()) return;

      // Starlight is the preferred renderer; when it is unavailable we render
      // the active account's local skin bytes via skinview3d instead of
      // falling back to the default Steve skin.
      const useLocalFallback = () => {
        if (activeSkin?.base64_data) {
          setFallbackSkinUrl(`data:image/png;base64,${activeSkin.base64_data}`);
          setFallbackSkinVariant(activeSkin.variant ?? "classic");
          warnFallbackOnce();
        } else {
          setResolvedSkinUrl(DEFAULT_FALLBACK_SKIN_URL);
          setFallbackSkinUrl(null);
        }
      };

      try {
        const payload: GetStarlightSkinRenderPayload = {
          player_name: playerName,
          render_type: "default",
          render_view: "full",
          base64_skin_data: activeSkin?.base64_data ?? null,
        };
        const localPath =
          await MinecraftSkinService.getStarlightSkinRender(payload);
        if (!isCurrentRequest()) return;

        if (localPath) {
          setResolvedSkinUrl(convertFileSrc(localPath));
          setFallbackSkinUrl(null);
        } else {
          useLocalFallback();
        }
      } catch (error) {
        if (!isCurrentRequest()) return;
        console.error(
          "[PlayerActionsDisplay] Failed to fetch starlight skin render:",
          error,
        );
        useLocalFallback();
      }
    };

    fetchAndSetSkin();

    return () => {
      if (isCurrentRequest()) {
        skinPreviewRequestIdRef.current += 1;
      }
    };
  }, [playerName, skinRevision, t]);

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

  const worldCupActive = isWorldCupEventActive();
  const featuredLaunchOverrides: LaunchOverrides | undefined = worldCupActive
    ? {
        game_version: WM_PUBLIC_VIEWING.gameVersion,
        loader: WM_PUBLIC_VIEWING.loader,
        pack: WM_PUBLIC_VIEWING.pack,
      }
    : undefined;

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
        {fallbackSkinUrl ? (
          <div style={skinViewerStyles} className="bg-transparent flex-shrink-0">
            <SkinView3DWrapper
              skinUrl={fallbackSkinUrl}
              skinVariant={fallbackSkinVariant}
              width={skinViewerMaxDisplayWidth}
              height={skinViewerDisplayHeight}
              zoom={0.95}
            />
          </div>
        ) : (
          <SkinViewer
            skinUrl={resolvedSkinUrl}
            playerName={playerName?.toString()}
            width={skinViewerMaxDisplayWidth}
            height={skinViewerDisplayHeight}
            className="bg-transparent flex-shrink-0"
            style={skinViewerStyles}
          />
        )}

        {!isLoadingProfiles && (
          <>
            {/* Featured Server Toggle - above the launch button */}
            <div
              className={`absolute left-0 right-0 flex justify-center px-4 z-30 transition-all duration-300 ${featureMode ? 'bottom-40' : 'bottom-32'}`}
            >
              {!featureMode && worldCupActive ? (
                <StaticTooltip
                  content={t('wm.tooltip', {
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
                      <FeaturedPromoIcon src={WM_PUBLIC_VIEWING.iconSrc} alt="" size="md" />
                      {t('wm.public_viewing').toLowerCase()}
                    </span>
                  </button>
                </StaticTooltip>
              ) : (
                <button
                  onClick={handleTopToggle}
                  className="font-minecraft text-2xl lowercase text-white/70 hover:text-white transition-all duration-200 cursor-pointer bg-transparent border-none p-0 whitespace-nowrap text-shadow"
                  title={
                    featureMode
                      ? t('wm.switch_to_main')
                      : t('wm.switch_to_hugo', { server: FEATURED_SERVER.name })
                  }
                >
                  {featureMode
                    ? t('wm.switch_to_main')
                    : FEATURED_SERVER.name.toLowerCase()}
                </button>
              )}
            </div>
            <div className="absolute bottom-8 left-0 right-0 flex justify-center px-4">
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
                    mainButtonWidth="w-80"
                    maxWidth="400px"
                    mainButtonHeight="h-20"
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
