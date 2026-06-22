"use client";

import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { MainLaunchButton } from './MainLaunchButton';
import { useThemeStore } from '../../store/useThemeStore';
import { Icon } from '@iconify/react';
// DISABLED: ProfileCardV2 was used for featured profile mode
// import { ProfileCardV2 } from '../profiles/ProfileCardV2';
import { ServerLaunchCard } from './ServerLaunchCard';
import { useProfileStore } from '../../store/profile-store';
import { useMinecraftAuthStore } from '../../store/minecraft-auth-store';
import { SkinRenderer } from '@noriskclient/nrc-skin-renderer/react';
import { useActiveSkinTexture } from '../../hooks/useActiveSkinTexture';
import { useEquippedCosmetics } from '../../hooks/useEquippedCosmetics';
import { useSelectedIcon } from '../../hooks/useSelectedIcon';
import { useIdleEmote } from '../../hooks/useIdleEmote';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

// Featured server configuration
// Option A: profileId = null → uses currently selected profile from MainLaunchButton
// Option B: profileId = "uuid" → uses dedicated profile for this server
const FEATURED_SERVER = {
  address: "hugosmp.net",
  name: "HUGOSMP.net",
  profileId: null as string | null, // TODO: Set dedicated profile ID for Option B
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
  const navigate = useNavigate();

  const { profiles } = useProfileStore();

  // Determine if we're still loading profiles (no profiles loaded yet)
  const isLoadingProfiles = profiles.length === 0;

  // Get the profile ID to use for featured server launch
  // Option A: Use currently selected profile from MainLaunchButton
  // Option B: Use dedicated profile ID if configured
  const getFeaturedServerProfileId = (): string | null => {
    // Option B: If dedicated profile ID is set, use it
    if (FEATURED_SERVER.profileId) {
      return FEATURED_SERVER.profileId;
    }

    // Option A: Use currently selected profile from MainLaunchButton
    const selectedVersion = launchButtonVersions.find(v => v.id === launchButtonDefaultVersion);
    return selectedVersion?.profileId || null;
  };

  const featuredServerProfileId = getFeaturedServerProfileId();

  // Handle mods button for featured server
  const handleFeaturedServerMods = () => {
    if (!featuredServerProfileId) {
      toast.error(t('profiles.errors.no_profile_selected'));
      return;
    }

    // Navigate to profile detail view (which has mods tab)
    navigate(`/profilesv2/${featuredServerProfileId}`);
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
            emote={idleEmote}
            nametag={playerName ? { text: playerName, iconUrl: selectedIcon.url, iconPlus: selectedIcon.plus } : null}
            loading={rigLoading}
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

        {/* Don't render launch button while profiles are still loading to prevent flicker */}
        {!isLoadingProfiles && (
          <>
            {/* Featured Server Toggle - above the launch button */}
            <div
              className={`absolute left-0 right-0 flex justify-center px-4 z-30 transition-all duration-300 ${featureMode ? 'bottom-40' : 'bottom-32'}`}
            >
              <button
                onClick={() => setFeatureMode(!featureMode)}
                className="font-minecraft text-2xl lowercase text-white/70 hover:text-white transition-all duration-200 cursor-pointer bg-transparent border-none p-0 whitespace-nowrap text-shadow"
                title={featureMode ? "Switch to Main Launch" : `Switch to ${FEATURED_SERVER.name}`}
              >
                {featureMode ? "switch to main launch" : FEATURED_SERVER.name.toLowerCase()}
              </button>
            </div>
            <div className="absolute bottom-8 left-0 right-0 flex justify-center px-4">
              {featureMode ? (
                // Show featured server card with MOTD
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
            </div>
          </>
        )}
      </div>
    </div>
  );
} 