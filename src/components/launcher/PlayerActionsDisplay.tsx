"use client";

import React, { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import { SkinViewer } from './SkinViewer';
import { MainLaunchButton } from './MainLaunchButton';
import { useThemeStore } from '../../store/useThemeStore';
import { MinecraftSkinService } from '../../services/minecraft-skin-service';
import type { GetStarlightSkinRenderPayload } from '../../types/localSkin';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Icon } from '@iconify/react';
import { ProfileCardV2 } from '../profiles/ProfileCardV2';
import { useProfileStore } from '../../store/profile-store';

const DEFAULT_FALLBACK_SKIN_URL = "/skins/default_steve_full.png"; // Defined constant for fallback URL

// Featured profile ID - can be null or a UUID string
const FEATURED_PROFILE_ID: string | null = "d2332f66-9117-4cf3-b35b-6bac4262f984"; // Set to a valid profile UUID to enable feature toggle, or null to disable

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

export function PlayerActionsDisplay({
  playerName,
  launchButtonDefaultVersion,
  onLaunchVersionChange,
  launchButtonVersions,
  className,
  displayMode = 'playerName',
}: PlayerActionsDisplayProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const featureMode = useThemeStore((state) => state.featureMode);
  const setFeatureMode = useThemeStore((state) => state.setFeatureMode);
  const [resolvedSkinUrl, setResolvedSkinUrl] = useState<string>(DEFAULT_FALLBACK_SKIN_URL);

  const { profiles } = useProfileStore();
  const featuredProfile = FEATURED_PROFILE_ID ? profiles.find(p => p.id === FEATURED_PROFILE_ID) : null;

  // Determine if we're still loading profiles (no profiles loaded yet)
  const isLoadingProfiles = profiles.length === 0;

  // Reset featureMode to false if no featured profile is configured
  React.useEffect(() => {
    if (!FEATURED_PROFILE_ID && featureMode) {
      setFeatureMode(false);
    }
  }, [FEATURED_PROFILE_ID, featureMode, setFeatureMode]);

  useEffect(() => {
    const fetchAndSetSkin = async () => {
      if (playerName) {
        try {
          const payload: GetStarlightSkinRenderPayload = {
            player_name: playerName,
            render_type: "default", 
            render_view: "full",    
          };
          console.log("[PlayerActionsDisplay] Fetching skin for:", playerName, "Payload:", payload);
          const localPath = await MinecraftSkinService.getStarlightSkinRender(payload);
          console.log("[PlayerActionsDisplay] Fetched local path:", localPath);
          if (localPath) { // Check if path is not empty or null
            setResolvedSkinUrl(convertFileSrc(localPath));
          } else {
            console.warn("[PlayerActionsDisplay] Received empty path from service, using fallback.");
            setResolvedSkinUrl(DEFAULT_FALLBACK_SKIN_URL);
          }
        } catch (error) {
          console.error("[PlayerActionsDisplay] Failed to fetch starlight skin render:", error);
          setResolvedSkinUrl(DEFAULT_FALLBACK_SKIN_URL); // Fallback on error
        }
      } else {
        console.log("[PlayerActionsDisplay] No player name, using default fallback skin.");
        setResolvedSkinUrl(DEFAULT_FALLBACK_SKIN_URL);
      }
    };

    fetchAndSetSkin();
  }, [playerName]);

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

  return (
    <div className={cn("flex flex-col items-center", className)}>
      {/* Featured Modpack Toggle - only show if featured profile exists and profiles are loaded */}
      {!isLoadingProfiles && featuredProfile && (
        <div className="absolute bottom-32 left-0 right-0 flex justify-center px-4 z-30">
          <button
            onClick={() => setFeatureMode(!featureMode)}
            className="font-minecraft text-2xl lowercase text-white/70 hover:text-white transition-all duration-200 cursor-pointer bg-transparent border-none p-0 whitespace-nowrap text-shadow"
            title={featureMode ? "Switch to Main Launch" : "Switch to Craft Attack Modpack"}
          >
            {featureMode ? "switch to main launch" : "craft attack modpack"}
          </button>
        </div>
      )}

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

        {/* Don't render launch button while profiles are still loading to prevent flicker */}
        {!isLoadingProfiles && (
          <div className="absolute bottom-8 left-0 right-0 flex justify-center px-4">
            <div className={featureMode && featuredProfile ? "w-96" : "max-w-xs sm:max-w-sm"}>
              {featureMode && featuredProfile ? (
              // Use actual ProfileCardV2 component with 3D styling for featured profile
              <div className="w-96 h-20 flex items-center justify-center">
                <div className="w-full h-full">
                  <ProfileCardV2
                    profile={featuredProfile}
                    layoutMode="compact"
                    variant="3d"
                  />
                </div>
              </div>
            ) : (
              <MainLaunchButton
                defaultVersion={launchButtonDefaultVersion}
                onVersionChange={onLaunchVersionChange}
                versions={launchButtonVersions}
                selectedVersionLabel={selectedVersionLabel}
                mainButtonWidth="w-80"
                maxWidth="400px"
                mainButtonHeight="h-20"
              />
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
} 