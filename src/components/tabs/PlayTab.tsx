"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { EditionSwitch, useLauncherEdition } from "../edition/EditionSwitch";
import { LocalServerService } from "../../services/local-server-service";
import type { BedrockProfile } from "../../types/localServer";
import { MinecraftSkinService } from "../../services/minecraft-skin-service";
import type { MinecraftSkin } from "../../types/localSkin";
import { useSkinStore } from "../../store/useSkinStore";
import { toast } from "sonner";

export function PlayTab() {
  const { edition } = useLauncherEdition();
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
  const selectedSkinId = useSkinStore((state) => state.selectedSkinId);
  const [bedrockProfiles, setBedrockProfiles] = useState<BedrockProfile[]>([]);
  const [bedrockSkins, setBedrockSkins] = useState<MinecraftSkin[]>([]);
  const [selectedBedrockProfileId, setSelectedBedrockProfileId] = useState(
    () => localStorage.getItem("nrc-bedrock-selected-profile-id") || "",
  );

  useEffect(() => { setDiscordState("Idling"); }, []);

  const loadBedrockData = useCallback(async () => {
    if (edition !== "bedrock") return;
    try {
      const [nextProfiles, nextSkins] = await Promise.all([
        LocalServerService.listBedrockProfiles(),
        MinecraftSkinService.getAllSkins(),
      ]);
      setBedrockProfiles(nextProfiles);
      setBedrockSkins(nextSkins);
      if (!nextProfiles.some((profile) => profile.id === selectedBedrockProfileId)) {
        const firstId = nextProfiles[0]?.id || "";
        setSelectedBedrockProfileId(firstId);
        if (firstId) localStorage.setItem("nrc-bedrock-selected-profile-id", firstId);
      }
    } catch (error) {
      toast.error(String(error));
    }
  }, [edition, selectedBedrockProfileId]);

  useEffect(() => {
    void loadBedrockData();
  }, [loadBedrockData]);

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

  const selectedBedrockProfile =
    bedrockProfiles.find((profile) => profile.id === selectedBedrockProfileId) || bedrockProfiles[0] || null;
  const selectedBedrockSkin = useMemo(
    () => bedrockSkins.find((skin) => skin.id === selectedSkinId) || bedrockSkins[0] || null,
    [bedrockSkins, selectedSkinId],
  );
  const bedrockVersions = bedrockProfiles.map((profile) => ({
    id: profile.id,
    label: `${profile.name} - ${profile.target === "preview" ? "Preview" : "Release"}`,
    icon: "bedrock",
    isCustom: true,
    profileId: profile.id,
  }));

  const handleBedrockProfileChange = (profileId: string) => {
    setSelectedBedrockProfileId(profileId);
    localStorage.setItem("nrc-bedrock-selected-profile-id", profileId);
  };

  const launchBedrock = async () => {
    if (!selectedBedrockProfile) return;
    const launched = await LocalServerService.launchBedrockProfile(selectedBedrockProfile.id);
    setBedrockProfiles((current) => current.map((profile) => profile.id === launched.id ? launched : profile));
    window.dispatchEvent(new CustomEvent("nrc-bedrock-instance-changed"));
    toast.success(`${launched.name} wird gestartet`);
  };

  return (
    <div className="flex h-full relative">
      <div className="flex-grow flex flex-col items-center justify-center p-8 relative z-15">
        {/* Only show RetroGrid effect if no theme background is active */}
        {currentEffect === BACKGROUND_EFFECTS.RETRO_GRID && !(isThemeActive && selectedTheme?.backgroundImage) && (
          <RetroGridEffect
            renderMode="both"
            isAnimationEnabled={!staticBackground}
            customGridLineColor={`${accentColor.value}80`}
          />
        )}

        <div className="absolute top-3 left-3 z-20 flex flex-col items-start gap-3">
          <EditionSwitch />
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

        <div className="relative z-10">
          {profilesError && !loading && (
            <ErrorMessage
              message={profilesError || "An unknown error occurred"}
            />
          )}

          <PlayerActionsDisplay
            displayMode="playerName"
            playerName={edition === "bedrock"
              ? selectedBedrockProfile?.name || activeAccount?.minecraft_username || activeAccount?.username
              : activeAccount?.minecraft_username || activeAccount?.username}
            launchButtonDefaultVersion={
              edition === "bedrock"
                ? selectedBedrockProfile?.id || bedrockVersions[0]?.id || ""
                : storeSelectedProfile?.id || versions[0]?.id || ""
            }
            onLaunchVersionChange={edition === "bedrock" ? handleBedrockProfileChange : handleVersionChange}
            launchButtonVersions={edition === "bedrock" ? bedrockVersions : versions}
            skinBase64={edition === "bedrock" ? selectedBedrockSkin?.base64_data : undefined}
            onLaunchOverride={edition === "bedrock" ? launchBedrock : undefined}
            disableFeaturedServer={edition === "bedrock"}
            pickerRoute="/profiles"
            className=""
          />
        </div>
      </div>

      <NewsSection className="w-1/3 border-l-2 border-white/40 bg-black/10 backdrop-blur-lg p-5 overflow-hidden flex flex-col relative z-10" />
    </div>
  );
}
