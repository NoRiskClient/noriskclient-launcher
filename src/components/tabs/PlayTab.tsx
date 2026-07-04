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
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useQualitySettingsStore } from "../../store/quality-settings-store";
import { useLauncherTheme } from "../../hooks/useLauncherTheme";
import { useIsMobile } from "../../hooks/useIsMobile";
import { setDiscordState } from "../../utils/discordRpc";
// TODO(mobile-poc): remove temporary JVM test wiring
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { parseErrorMessage } from "../../utils/error-utils";

export function PlayTab() {
  const {
    profiles,
    selectedProfile: storeSelectedProfile,
    loading,
    error: profilesError,
    setSelectedProfile,
  } = useProfileStore();

  const { activeAccount } = useMinecraftAuthStore();
  const { staticBackground, accentColor } = useThemeStore();
  const { currentEffect } = useBackgroundEffectStore();
  const { isThemeActive, selectedTheme } = useLauncherTheme();
  const { cosmeticRenderer3d, setCosmeticRenderer3d } = useQualitySettingsStore();
  const isMobile = useIsMobile();
  // TODO(mobile-poc): remove temporary JVM test state
  const [jvmTesting, setJvmTesting] = useState(false);
  const [mcTesting, setMcTesting] = useState(false);

  const runJvmTest = async () => {
    if (jvmTesting) return;
    setJvmTesting(true);
    try {
      const result = await invoke<string>("test_mobile_jvm", {
        runtimeUrl:
          "/data/data/gg.norisk.NoRiskClientLauncherV3/files/nrc-jre21.tar.gz",
      });
      toast.success(result, { duration: 10000 });
    } catch (e) {
      toast.error(parseErrorMessage(e), { duration: 10000 });
    } finally {
      setJvmTesting(false);
    }
  };

  // TODO(mobile-poc): temporary vanilla launch test (downloads + boots MC in-process)
  const runMcTest = async () => {
    if (mcTesting) return;
    setMcTesting(true);
    toast("MC-Launch gestartet - Pipeline laedt, Fortschritt in mc-android.log", {
      duration: 8000,
    });
    try {
      await invoke("launch_temp_profile", {
        args: {
          game_version: "1.21.11",
          loader: "vanilla",
          loader_version: null,
          pack: null,
          name: "android-poc",
          quick_play_singleplayer: null,
          quick_play_multiplayer: null,
          local_mods: [],
          account: "offline",
        },
      });
      toast.success("Launch-Pipeline fertig - JVM-Thread gestartet", {
        duration: 12000,
      });
    } catch (e) {
      toast.error(parseErrorMessage(e), { duration: 15000 });
    } finally {
      setMcTesting(false);
    }
  };

  useEffect(() => { setDiscordState("Idling"); }, []);

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

  // promo-outline shader settings for the 3D player preview
  const outline = { strength: 4, thickness: 3, sensitivity: 0.1 };

  return (
    <div className="flex h-full relative">
      <div className={`flex-grow flex flex-col items-center justify-center relative z-15 ${isMobile ? "p-4" : "p-8"}`}>
        {/* Only show RetroGrid effect if no theme background is active */}
        {currentEffect === BACKGROUND_EFFECTS.RETRO_GRID && !(isThemeActive && selectedTheme?.backgroundImage) && (
          <RetroGridEffect
            renderMode="both"
            isAnimationEnabled={!staticBackground}
            customGridLineColor={`${accentColor.value}80`}
          />
        )}

        {/* Referral Banner - Top Left */}
        <div className="absolute top-3 left-3 z-20">
          <ReferralBanner />
        </div>

        {/* TODO(mobile-poc): temporary JVM/MC test buttons */}
        {isMobile && (
          <div className="absolute top-3 right-3 z-30 flex gap-2">
            <button
              onClick={runJvmTest}
              disabled={jvmTesting}
              className="border border-white/30 rounded-md bg-black/60 text-white font-minecraft-ten text-[11px] px-3 py-2 cursor-pointer disabled:opacity-50"
            >
              {jvmTesting ? "JVM..." : "JVM TEST"}
            </button>
            <button
              onClick={runMcTest}
              disabled={mcTesting}
              className="border border-green-400/40 rounded-md bg-black/60 text-green-300 font-minecraft-ten text-[11px] px-3 py-2 cursor-pointer disabled:opacity-50"
            >
              {mcTesting ? "MC..." : "MC TEST"}
            </button>
          </div>
        )}

        {/* 3D Render Toggle - Top Right (desktop only, too cramped on phones) */}
        {!isMobile && (
        <div className="absolute top-6 right-6 z-20 flex items-center gap-2">
          <span className="text-sm text-white/70 font-minecraft-ten">SKIN ANIMATION</span>
          <ToggleSwitch
            checked={cosmeticRenderer3d}
            onChange={() => setCosmeticRenderer3d(!cosmeticRenderer3d)}
            size="sm"
          />
        </div>
        )}

        {/* <VersionInfo
          profileId={currentDisplayProfile?.id || ""}
          className="absolute top-6 left-6 z-10"
        /> */}

        <div className="relative z-10">
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
            className=""
            outline={outline}
          />
        </div>
      </div>

      {!isMobile && (
        <NewsSection className="w-1/3 border-l-2 border-white/40 bg-black/10 backdrop-blur-lg p-5 overflow-hidden flex flex-col relative z-10" />
      )}
    </div>
  );
}
