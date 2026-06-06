"use client";

import { useEffect } from "react";
import { NewsSection } from "../news/NewsSection";
import { ErrorMessage } from "../ui/ErrorMessage";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { useProfileStore } from "../../store/profile-store";
import { useThemeStore } from "../../store/useThemeStore";
import { PlayerActionsDisplay } from "../launcher/PlayerActionsDisplay";
import { RetroGridEffect } from "../effects/RetroGridEffect";
import {
  BACKGROUND_EFFECTS,
  useBackgroundEffectStore,
} from "../../store/background-effect-store";
// DISABLED: Snow effect (seasonal feature)
// import { SnowEffectToggle } from "../ui/SnowEffectToggle";
import { ReferralBanner } from "../ui/ReferralBanner";
import { useLauncherTheme } from "../../hooks/useLauncherTheme";
import { setDiscordState } from "../../utils/discordRpc";

export function PlayTab() {
  const {
    profiles,
    selectedProfile: storeSelectedProfile,
    loading,
    error: profilesError,
    setSelectedProfile,
  } = useProfileStore();

  const { activeAccount } = useMinecraftAuthStore();
  const { staticBackground, accentColor, uiStylePreset } = useThemeStore();
  const isFullRiskStyle = uiStylePreset === "fullrisk";
  const { currentEffect } = useBackgroundEffectStore();
  const { isThemeActive, selectedTheme } = useLauncherTheme();

  useEffect(() => {
    setDiscordState("Idling");
  }, []);

  useEffect(() => {
    if (!storeSelectedProfile && profiles.length > 0) {
      setSelectedProfile(profiles[0]);
    }
  }, [storeSelectedProfile, profiles, setSelectedProfile]);

  const handleVersionChange = (versionId: string) => {
    const profileToSelect = profiles.find((p) => p.id === versionId) || null;
    setSelectedProfile(profileToSelect);
  };

  const currentDisplayProfile =
    storeSelectedProfile || (profiles.length > 0 ? profiles[0] : null);

  const versions = profiles.map((profile) => ({
    id: profile.id,
    label: `${profile.name}`,
    icon: profile.loader === "vanilla" ? undefined : profile.loader,
    isCustom: profile.loader !== "vanilla",
    profileId: profile.id,
  }));

  return (
    <div
      className={
        isFullRiskStyle
          ? "h-full relative overflow-hidden bg-[linear-gradient(180deg,rgba(26,25,28,0.12)_0%,rgba(26,25,28,0.56)_100%)]"
          : "flex h-full relative"
      }
    >
      <div
        className={
          isFullRiskStyle
            ? "h-full flex flex-col items-center justify-center px-7 py-8 relative z-15"
            : "flex-grow flex flex-col items-center justify-center p-8 relative z-15"
        }
      >
        {/* Only show RetroGrid effect if no theme background is active */}
        {currentEffect === BACKGROUND_EFFECTS.RETRO_GRID &&
          !(isThemeActive && selectedTheme?.backgroundImage) && (
            <RetroGridEffect
              renderMode="both"
              isAnimationEnabled={!staticBackground}
              customGridLineColor={`${accentColor.value}80`}
            />
          )}

        {/* Referral Banner - Top Left */}
        <div
          className={
            isFullRiskStyle
              ? "absolute top-6 left-6 z-20"
              : "absolute top-3 left-3 z-20"
          }
        >
          <ReferralBanner />
        </div>

        {/* DISABLED: Snow Effect Toggle - Top Right (seasonal feature)
        <div className="absolute top-6 right-6 z-20">
          <SnowEffectToggle variant="compact" size="sm" />
        </div>
        */}

        {/* <VersionInfo
          profileId={currentDisplayProfile?.id || ""}
          className="absolute top-6 left-6 z-10"
        /> */}

        <div
          className={
            isFullRiskStyle
              ? "relative z-10 w-full h-full flex items-center justify-center"
              : "relative z-10"
          }
        >
          {profilesError && !loading && (
            <ErrorMessage
              message={profilesError || "An unknown error occurred"}
            />
          )}

          <PlayerActionsDisplay
            displayMode="playerName"
            playerName={
              activeAccount?.minecraft_username || activeAccount?.username
            }
            launchButtonDefaultVersion={
              storeSelectedProfile?.id || versions[0]?.id || ""
            }
            onLaunchVersionChange={handleVersionChange}
            launchButtonVersions={versions}
            className={isFullRiskStyle ? "w-full max-w-[1120px]" : ""}
          />
        </div>
      </div>

      {isFullRiskStyle ? (
        <NewsSection className="absolute bottom-6 right-6 z-40" />
      ) : (
        <NewsSection className="w-1/3 border-2 bg-black/10 backdrop-blur-lg p-5 overflow-hidden flex flex-col relative z-10" />
      )}
    </div>
  );
}
