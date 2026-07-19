"use client";

import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { MainLaunchButton } from './MainLaunchButton';
import { SkinViewer } from './SkinViewer';
import { useThemeStore } from '../../store/useThemeStore';
import { Icon } from '@iconify/react';
import { ServerLaunchCard } from './ServerLaunchCard';
import { useProfileStore } from '../../store/profile-store';
import { useMinecraftAuthStore } from '../../store/minecraft-auth-store';
import { SkinRenderer } from '@noriskclient/nrc-skin-renderer/react';
import type { PromoOutlineConfig } from '@noriskclient/nrc-skin-renderer/postfx';
import { useActiveSkinTexture } from '../../hooks/useActiveSkinTexture';
import { useEquippedCosmetics } from '../../hooks/useEquippedCosmetics';
import { useSelectedIcon } from '../../hooks/useSelectedIcon';
import { useIdleEmote } from '../../hooks/useIdleEmote';
import { useStarlightRender } from '../../hooks/useStarlightRender';
import { useQualitySettingsStore } from '../../store/quality-settings-store';
import { useWindowFocus } from '../../hooks/useWindowFocus';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StaticTooltip } from '../ui/Tooltip';
import { toast } from 'sonner';
import { isWorldCupEventActive } from '../../data/worldcup-event';
import type { LaunchOverrides } from '../../services/process-service';

// Featured server configuration
// Option A: profileId = null → uses currently selected profile from MainLaunchButton
// Option B: profileId = "uuid" → uses dedicated profile for this server
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
  outline?: Partial<PromoOutlineConfig>;
}

function useMinLoading(active: boolean, minMs: number): boolean {
  const [done, setDone] = useState(false);
  const startRef = useRef(Date.now());
  useEffect(() => {
    if (active) return;
    const remaining = Math.max(0, minMs - (Date.now() - startRef.current));
    const id = setTimeout(() => setDone(true), remaining);
    return () => clearTimeout(id);
  }, [active, minMs]);
  return active || !done;
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
  outline,
}: PlayerActionsDisplayProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const featureMode = useThemeStore((state) => state.featureMode);
  const setFeatureMode = useThemeStore((state) => state.setFeatureMode);
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

  const dropShadowX = '2px';
  const dropShadowY = '4px';
  const dropShadowBlur = '6px';
  const commonDropShadowStyle = `drop-shadow(${dropShadowX} ${dropShadowY} ${dropShadowBlur} ${accentColor.value})`;
  
  const skinViewerDisplayHeight = 450;
  const skinViewerMaxDisplayWidth = 225;

  const rigDisplayWidth = 1040;
  const rigDisplayHeight = 860;

  const skinViewerStyles: React.CSSProperties = {
    filter: 'drop-shadow(5px 10px 5px rgba(0,0,0,0.75))',
    WebkitBoxReflect: 'below 0px linear-gradient(to bottom, transparent, rgba(0,0,0,0.05))',
    height: `${skinViewerDisplayHeight}px`,
    width: 'auto',
    maxWidth: `${skinViewerMaxDisplayWidth}px`,
  };

  const selectedVersionLabel = launchButtonVersions.find(v => v.id === launchButtonDefaultVersion)?.label;

  const activeAccount = useMinecraftAuthStore((state) => state.activeAccount);
  const { textureUrl: rigTextureUrl, variant: rigVariant, loading: skinLoading } = useActiveSkinTexture();
  const { cosmetics: equippedCosmetics, loading: cosmeticsLoading } = useEquippedCosmetics(activeAccount?.id);
  const selectedIcon = useSelectedIcon(activeAccount?.id);
  const idleEmote = useIdleEmote();
  const cosmeticRenderer3d = useQualitySettingsStore((s) => s.cosmeticRenderer3d);
  const isWindowFocused = useWindowFocus();
  const resolvedSkinUrl = useStarlightRender(!cosmeticRenderer3d, playerName);
  const rigLoading = useMinLoading(skinLoading || cosmeticsLoading, 450);
  const rigCosmetics = React.useMemo(
    () =>
      equippedCosmetics.map((c) => ({
        id: c.cosmeticId,
        type: c.type,
        urls: c.urls,
      })),
    [equippedCosmetics],
  );

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
      ) : null}

      <div className={cn(
        "relative w-full max-w-[500px] flex flex-col items-center",
        displayMode === 'logo' && "z-10"
      )}>
        {cosmeticRenderer3d ? (
          <div
            className="relative flex-shrink-0"
            style={{
              width: `${skinViewerMaxDisplayWidth}px`,
              height: `${skinViewerDisplayHeight}px`,
            }}
          >
            <SkinRenderer
              textureUrl={rigTextureUrl}
              variant={rigVariant}
              cosmetics={rigCosmetics}
              emote={idleEmote.urls}
              emoteLoop={idleEmote.loop}
              onEmoteEnd={idleEmote.onEnd}
              outline={outline}
              nametag={playerName ? { text: playerName, iconUrl: selectedIcon.url, iconPlus: selectedIcon.plus } : null}
              loading={rigLoading}
              paused={!isWindowFocused}
              fps={60}
              maxDpr={1.5}
              skeletonColor={accentColor.value}
              className="bg-transparent"
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: `${rigDisplayWidth}px`,
                height: `${rigDisplayHeight}px`,
                pointerEvents: "none",
                filter: skinViewerStyles.filter,
              }}
            />
          </div>
        ) : (
          <SkinViewer
            skinUrl={resolvedSkinUrl}
            playerName={playerName?.toString()}
            width={skinViewerMaxDisplayWidth}
            height={skinViewerDisplayHeight}
            className="bg-transparent flex-shrink-0"
            style={{ ...skinViewerStyles, transform: "translateY(30px)" }}
          />
        )}

        {!isLoadingProfiles && (
          <>
            {/* Featured Server Toggle - above the launch button */}
            <div
              className={`absolute left-0 right-0 flex justify-center px-4 z-30 transition-all duration-300 ${cosmeticRenderer3d ? (featureMode ? 'bottom-32' : 'bottom-24') : (featureMode ? 'bottom-40' : 'bottom-32')}`}
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
                    className="font-smallcaps text-base text-white/70 hover:text-white transition-all duration-200 cursor-pointer bg-transparent border-none p-0 whitespace-nowrap text-shadow"
                  >
                    <span className="flex items-center gap-2">
                      <FeaturedPromoIcon src={WM_PUBLIC_VIEWING.iconSrc} alt="" size="md" />
                      {t('wm.public_viewing')}
                    </span>
                  </button>
                </StaticTooltip>
              ) : (
                <button
                  onClick={handleTopToggle}
                  className="font-smallcaps text-base text-white/70 hover:text-white transition-all duration-200 cursor-pointer bg-transparent border-none p-0 whitespace-nowrap text-shadow"
                  title={
                    featureMode
                      ? t('wm.switch_to_main')
                      : t('wm.switch_to_hugo', { server: FEATURED_SERVER.name })
                  }
                >
                  {featureMode
                    ? t('wm.switch_to_main')
                    : FEATURED_SERVER.name}
                </button>
              )}
            </div>
            <div className={`absolute left-0 right-0 flex justify-center px-4 ${cosmeticRenderer3d ? 'bottom-2' : 'bottom-8'}`}>
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
