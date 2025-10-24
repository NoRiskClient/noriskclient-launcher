"use client";

import React, { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import { SkinViewer } from './SkinViewer';
import { MainLaunchButton } from './MainLaunchButton';
import { useThemeStore } from '../../store/useThemeStore';
import { useSkinVisibilityStore } from '../../store/useSkinVisibilityStore';
import { MinecraftSkinService } from '../../services/minecraft-skin-service';
import type { GetStarlightSkinRenderPayload } from '../../types/localSkin';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Icon } from '@iconify/react';

const DEFAULT_FALLBACK_SKIN_URL = "/skins/default_steve_full.png"; // Defined constant for fallback URL

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
  const { isSkinVisible, toggleSkinVisibility } = useSkinVisibilityStore();
  const [resolvedSkinUrl, setResolvedSkinUrl] = useState<string>(DEFAULT_FALLBACK_SKIN_URL);

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
        isSkinVisible && (
          <h2 className="font-minecraft text-6xl text-center text-white mb-2 lowercase font-normal">
            {playerName || "no account"}
          </h2>
        )
      )}

      <div className={cn(
        "relative w-full max-w-[500px] flex flex-col items-center",
        displayMode === 'logo' && "z-10"
      )}>

        {isSkinVisible ? (
          <SkinViewer
            skinUrl={resolvedSkinUrl} 
            playerName={playerName?.toString()} 
            width={skinViewerMaxDisplayWidth} 
            height={skinViewerDisplayHeight} 
            className="bg-transparent flex-shrink-0"
            style={skinViewerStyles}
          />
        ) : (
          <div 
            className="bg-transparent flex-shrink-0"
            style={{ 
              width: skinViewerMaxDisplayWidth, 
              height: skinViewerDisplayHeight 
            }}
          />
        )}

        <div className="absolute bottom-8 left-0 right-0 flex justify-center px-4">
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
        </div>
      </div>
    </div>
  );
} 