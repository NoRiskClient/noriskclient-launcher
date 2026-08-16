"use client";

import { useState } from 'react';
import { cn } from '../../lib/utils';
import { MainLaunchButton } from './MainLaunchButton';
import { PlayerRig } from './PlayerRig';
import { useThemeStore } from '../../store/useThemeStore';
import { Icon } from '@iconify/react';
import { ServerLaunchCard } from './ServerLaunchCard';
import { useProfileStore } from '../../store/profile-store';
import type { PromoOutlineConfig } from '@noriskclient/nrc-skin-renderer/postfx';
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
      ) : null}

      <div className={cn(
        "relative w-full max-w-[500px] flex flex-col items-center",
        displayMode === 'logo' && "z-10"
      )}>
        <PlayerRig playerName={playerName} outline={outline} />

        {!isLoadingProfiles && (
          <>
            {/* Featured Server Toggle - above the launch button */}
            <div
              className={`absolute left-0 right-0 flex justify-center px-4 z-30 transition-all duration-300 ${featureMode ? 'bottom-32' : 'bottom-24'}`}
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
            <div className={`absolute left-0 right-0 flex justify-center px-4 bottom-2`}>
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
