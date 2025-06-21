"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import type { ModLoader, Profile } from "../../../types/profile";
import { invoke } from "@tauri-apps/api/core";
import { useThemeStore } from "../../../store/useThemeStore";
import { Select } from "../../ui/Select";
import { Card } from "../../ui/Card";
import { gsap } from "gsap";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/buttons/Button";

interface ModLoaderStepProps {
  profile: Partial<Profile>;
  updateProfile: (data: Partial<Profile>) => void;
}

interface LoaderVersionInfo {
  loader: {
    version: string;
    stable: boolean;
  };
}

export function ModLoaderStep({ profile, updateProfile }: ModLoaderStepProps) {
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkingCompatibility, setCheckingCompatibility] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compatibility, setCompatibility] = useState<
    Record<ModLoader, boolean>
  >({
    vanilla: true,
    fabric: false,
    forge: false,
    quilt: false,
    neoforge: false,
  });
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const loaderCardRef = useRef<HTMLDivElement>(null);
  const versionCardRef = useRef<HTMLDivElement>(null);
  const summaryCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isBackgroundAnimationEnabled && loaderCardRef.current) {
      gsap.fromTo(
        loaderCardRef.current,
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          ease: "power2.out",
        },
      );
    }
  }, [isBackgroundAnimationEnabled]);

  useEffect(() => {
    if (isBackgroundAnimationEnabled) {
      if (profile.loader !== "vanilla" && versionCardRef.current) {
        gsap.fromTo(
          versionCardRef.current,
          { opacity: 0, y: 20 },
          {
            opacity: 1,
            y: 0,
            duration: 0.4,
            ease: "power2.out",
          },
        );
      }

      if (
        profile.loader !== "vanilla" &&
        profile.loader_version &&
        summaryCardRef.current
      ) {
        gsap.fromTo(
          summaryCardRef.current,
          { opacity: 0, y: 20 },
          {
            opacity: 1,
            y: 0,
            duration: 0.4,
            ease: "power2.out",
          },
        );
      }
    }
  }, [profile.loader, profile.loader_version, isBackgroundAnimationEnabled]);

  const checkCompatibility = async () => {
    if (!profile.game_version) return;

    setCheckingCompatibility(true);
    setError(null);

    try {
      const newCompatibility: Record<ModLoader, boolean> = {
        vanilla: true,
        fabric: false,
        forge: false,
        quilt: false,
        neoforge: false,
      };

      try {
        const fabricVersions = await invoke<LoaderVersionInfo[]>(
          "get_fabric_loader_versions",
          {
            minecraftVersion: profile.game_version,
          },
        );
        newCompatibility.fabric = fabricVersions.length > 0;
      } catch (err) {
        console.error("Failed to check Fabric compatibility:", err);
      }

      try {
        const forgeVersions = await invoke<string[]>("get_forge_versions", {
          minecraftVersion: profile.game_version,
        });
        newCompatibility.forge = forgeVersions.length > 0;
      } catch (err) {
        console.error("Failed to check Forge compatibility:", err);
      }

      try {
        const neoforgeVersions = await invoke<string[]>(
          "get_neoforge_versions",
          {
            minecraftVersion: profile.game_version,
          },
        );
        newCompatibility.neoforge = neoforgeVersions.length > 0;
      } catch (err) {
        console.error("Failed to check NeoForge compatibility:", err);
      }

      try {
        const quiltVersions = await invoke<LoaderVersionInfo[]>(
          "get_quilt_loader_versions",
          {
            minecraftVersion: profile.game_version,
          },
        );
        newCompatibility.quilt = quiltVersions.length > 0;
      } catch (err) {
        console.error("Failed to check Quilt compatibility:", err);
      }

      setCompatibility(newCompatibility);

      if (
        profile.loader !== "vanilla" &&
        !newCompatibility[profile.loader as ModLoader]
      ) {
        updateProfile({ loader: "vanilla", loader_version: null });
      }
    } catch (err) {
      console.error("Error checking compatibility:", err);
      setError("failed to check mod loader compatibility");
    } finally {
      setCheckingCompatibility(false);
    }
  };

  const fetchLoaderVersions = async () => {
    if (!profile.game_version || profile.loader === "vanilla") {
      setLoaderVersions([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let versions: string[] = [];

      switch (profile.loader) {
        case "fabric":
          const fabricVersions = await invoke<LoaderVersionInfo[]>(
            "get_fabric_loader_versions",
            {
              minecraftVersion: profile.game_version,
            },
          );
          versions = fabricVersions.map(
            (v) => `${v.loader.version}${v.loader.stable ? " (stable)" : ""}`,
          );
          break;

        case "forge":
          versions = await invoke<string[]>("get_forge_versions", {
            minecraftVersion: profile.game_version,
          });
          break;

        case "neoforge":
          versions = await invoke<string[]>("get_neoforge_versions", {
            minecraftVersion: profile.game_version,
          });
          break;

        case "quilt":
          const quiltVersions = await invoke<LoaderVersionInfo[]>(
            "get_quilt_loader_versions",
            {
              minecraftVersion: profile.game_version,
            },
          );
          versions = quiltVersions.map(
            (v) => `${v.loader.version}${v.loader.stable ? " (stable)" : ""}`,
          );
          break;
      }

      setLoaderVersions(versions);

      if (versions.length > 0 && !profile.loader_version) {
        updateProfile({ loader_version: versions[0] });
      }
    } catch (err) {
      console.error(`Failed to fetch ${profile.loader} versions:`, err);
      setError(`failed to fetch ${profile.loader} versions`);
      setLoaderVersions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkCompatibility();
  }, [profile.game_version]);

  useEffect(() => {
    fetchLoaderVersions();
  }, [profile.loader, profile.game_version]);

  const handleSelectModLoader = (type: ModLoader) => {
    if (!compatibility[type]) return;
    updateProfile({ loader: type, loader_version: null });
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-minecraft text-white mb-3 lowercase">
          mod loader
        </h2>
        <p className="text-xs text-white/70 font-minecraft-ten tracking-wide">
          Choose a mod loader for your Minecraft profile. Some loaders may not
          be compatible with Minecraft {profile.game_version}.
        </p>
      </div>

      <Card
        ref={loaderCardRef}
        variant="flat"
        className="p-6 space-y-6 bg-black/20 border border-white/10"
      >
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 items-stretch">
          <ModLoaderCard
            name="vanilla"
            icon="/icons/minecraft.png"
            isSelected={profile.loader === "vanilla"}
            isCompatible={true}
            onClick={() => handleSelectModLoader("vanilla")}
            description="Pure Minecraft without mods"
            loading={false}
          />

          <ModLoaderCard
            name="fabric"
            icon="/icons/fabric.png"
            isSelected={profile.loader === "fabric"}
            isCompatible={compatibility.fabric}
            onClick={() => handleSelectModLoader("fabric")}
            description="Lightweight mod loader"
            loading={checkingCompatibility}
          />

          <ModLoaderCard
            name="forge"
            icon="/icons/forge.png"
            isSelected={profile.loader === "forge"}
            isCompatible={compatibility.forge}
            onClick={() => handleSelectModLoader("forge")}
            description="Classic mod loader"
            loading={checkingCompatibility}
          />

          <ModLoaderCard
            name="quilt"
            icon="/icons/quilt.png"
            isSelected={profile.loader === "quilt"}
            isCompatible={compatibility.quilt}
            onClick={() => handleSelectModLoader("quilt")}
            description="Fork of Fabric with more features"
            loading={checkingCompatibility}
          />

          <ModLoaderCard
            name="neoforge"
            icon="/icons/neoforge.png"
            isSelected={profile.loader === "neoforge"}
            isCompatible={compatibility.neoforge}
            onClick={() => handleSelectModLoader("neoforge")}
            description="Modern fork of Forge"
            loading={checkingCompatibility}
          />
        </div>
      </Card>

      {profile.loader !== "vanilla" && (
        <Card
          ref={versionCardRef}
          variant="flat"
          className="p-6 space-y-6 bg-black/20 border border-white/10"
        >
          <div>
            <label className="block text-2xl font-minecraft text-white mb-4 lowercase">{`${profile.loader} version`}</label>
            {loading ? (
              <div className="flex items-center gap-2 text-white/70">
                <Icon
                  icon="solar:refresh-bold"
                  className="w-5 h-5 animate-spin"
                />
                <span className="font-minecraft text-xl">
                  Loading {profile.loader} versions...
                </span>
              </div>
            ) : error ? (
              <div className="text-red-400 font-minecraft text-xl">{error}</div>
            ) : (
              <Select
                value={profile.loader_version || ""}
                onChange={(value) => updateProfile({ loader_version: value })}
                options={
                  loaderVersions.length === 0
                    ? [{ value: "", label: "No versions available" }]
                    : loaderVersions.map((version) => ({
                        value: version,
                        label: version,
                      }))
                }
                disabled={loaderVersions.length === 0}
              />
            )}
          </div>
        </Card>
      )}

      {profile.loader !== "vanilla" && profile.loader_version && (
        <Card
          ref={summaryCardRef}
          variant="flat"
          className="p-6 flex items-center gap-4 bg-black/20 border border-white/10"
        >
          <div className="w-12 h-12 flex items-center justify-center rounded-md overflow-hidden bg-black/30 border border-white/20">
            <img
              src={`/icons/${profile.loader}.png`}
              alt={profile.loader}
              className="w-8 h-8 object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).src = "/icons/minecraft.png";
              }}
            />
          </div>
          <div>
            <div className="text-2xl text-white font-minecraft tracking-wide lowercase">
              {profile.loader} {profile.loader_version}
            </div>
            <div className="text-xs text-white/70 tracking-wide font-minecraft-ten">
              For Minecraft {profile.game_version}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

interface ModLoaderCardProps {
  name: ModLoader;
  icon: string;
  isSelected: boolean;
  isCompatible: boolean;
  onClick: () => void;
  description: string;
  loading?: boolean;
}

function ModLoaderCard({
  name,
  icon,
  isSelected,
  isCompatible,
  onClick,
  description,
  loading = false,
}: ModLoaderCardProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const cardRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (cardRef.current && isSelected && isBackgroundAnimationEnabled) {
      gsap.fromTo(
        cardRef.current,
        { scale: 0.95 },
        {
          scale: 1,
          duration: 0.3,
          ease: "elastic.out(1.2, 0.4)",
        },
      );
    }
  }, [isSelected, isBackgroundAnimationEnabled]);

  return (
    <Button
      ref={cardRef}
      variant={isSelected ? "default" : "ghost"}
      className={cn(
        "p-6 flex flex-col items-center justify-start cursor-pointer w-full h-[160px]",
        isSelected
          ? "bg-black/30 grayscale-0 text-white"
          : isCompatible
            ? "bg-black/20 text-white/70 border-white/10 hover:bg-black/30 hover:text-white hover:border-white/20"
            : "bg-black/10 text-white/30 border-white/10 cursor-not-allowed",
      )}
      onClick={isCompatible ? onClick : undefined}
      disabled={!isCompatible}
    >
      <div className="flex-1 flex flex-col items-center justify-center">
        <img
          src={icon || "/placeholder.svg"}
          alt={name}
          className="w-12 h-12 mb-3 object-contain"
          style={{ opacity: isCompatible ? 1 : 0.5 }}
          onError={(e) => {
            (e.target as HTMLImageElement).src = "/icons/minecraft.png";
          }}
        />
        <span className="font-minecraft text-xl lowercase">{name}</span>
      </div>
      <div className="min-h-[20px] flex items-center justify-center">
        {loading ? (
          <div className="flex items-center gap-1">
            <Icon
              icon="solar:refresh-bold"
              className="w-4 h-4 animate-spin text-white/50"
            />
            <span className="text-sm text-white/50">checking...</span>
          </div>
        ) : (
          !isCompatible && (
            <span className="text-lg text-white/50">not compatible</span>
          )
        )}
      </div>
    </Button>
  );
}
