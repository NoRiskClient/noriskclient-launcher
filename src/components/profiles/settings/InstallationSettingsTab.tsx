"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import type { ModLoader, Profile } from "../../../types/profile";
import type { MinecraftVersion } from "../../../types/minecraft";
import { invoke } from "@tauri-apps/api/core";
import { StatusMessage } from "../../ui/StatusMessage";
import { useThemeStore } from "../../../store/useThemeStore";
import { SearchInput } from "../../ui/SearchInput";
import { Select } from "../../ui/Select";
import { Card } from "../../ui/Card";
import { gsap } from "gsap";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/buttons/Button";
import { toast } from "react-hot-toast";
import * as ProfileService from "../../../services/profile-service";

interface InstallationSettingsTabProps {
  profile: Profile;
  editedProfile: Profile;
  updateProfile: (updates: Partial<Profile>) => void;
}

type VersionType = "release" | "snapshot" | "old-beta" | "old-alpha";

export function InstallationSettingsTab({
  profile,
  editedProfile,
  updateProfile,
}: InstallationSettingsTabProps) {
  const [selectedVersionType, setSelectedVersionType] =
    useState<VersionType>("release");
  const [minecraftVersions, setMinecraftVersions] = useState<
    MinecraftVersion[]
  >([]);
  const [filteredVersions, setFilteredVersions] = useState<string[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(true);
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [isLoadingLoaderVersions, setIsLoadingLoaderVersions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isRepairing, setIsRepairing] = useState(false);
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const tabRef = useRef<HTMLDivElement>(null);
  const currentInstallRef = useRef<HTMLDivElement>(null);
  const versionTypesRef = useRef<HTMLDivElement>(null);
  const versionsRef = useRef<HTMLDivElement>(null);
  const platformsRef = useRef<HTMLDivElement>(null);
  const loaderVersionRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [previousLoader, setPreviousLoader] = useState<string>(
    editedProfile.loader || "vanilla",
  );

  useEffect(() => {
    const findScrollContainer = () => {
      let element: HTMLDivElement | null = tabRef.current;
      while (element) {
        const overflowY = window.getComputedStyle(element).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") {
          return element;
        }
        element = element.parentElement as HTMLDivElement | null;
      }
      return null;
    };

    if (tabRef.current) {
      scrollContainerRef.current = findScrollContainer();
    }
  }, []);

  useEffect(() => {
    const currentLoader = editedProfile.loader || "vanilla";

    if (previousLoader !== currentLoader) {
      if (
        currentLoader !== "vanilla" &&
        loaderVersionRef.current &&
        isBackgroundAnimationEnabled
      ) {
        scrollToLoaderVersion();
      }

      setPreviousLoader(currentLoader);
    }
  }, [editedProfile.loader, previousLoader, isBackgroundAnimationEnabled]);

  useEffect(() => {
    if (isBackgroundAnimationEnabled) {
      if (tabRef.current) {
        gsap.fromTo(
          tabRef.current,
          { opacity: 0 },
          { opacity: 1, duration: 0.4, ease: "power2.out" },
        );
      }

      const elements = [
        currentInstallRef.current,
        versionTypesRef.current,
        versionsRef.current,
        platformsRef.current,
      ].filter(Boolean);

      gsap.fromTo(
        elements,
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          stagger: 0.1,
          ease: "power2.out",
          delay: 0.2,
        },
      );
    }
  }, [isBackgroundAnimationEnabled]);

  useEffect(() => {
    async function fetchMinecraftVersions() {
      try {
        setIsLoadingVersions(true);
        setError(null);
        const result = await invoke<{ versions: MinecraftVersion[] }>(
          "get_minecraft_versions",
        );
        setMinecraftVersions(result.versions);
      } catch (err) {
        console.error("Failed to fetch Minecraft versions:", err);
        setError(
          `failed to fetch minecraft versions: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setIsLoadingVersions(false);
      }
    }

    fetchMinecraftVersions();
  }, []);

  useEffect(() => {
    if (minecraftVersions.length > 0) {
      const filtered = minecraftVersions
        .filter((version) => version.type === selectedVersionType)
        .filter((version) =>
          searchQuery
            ? version.id.toLowerCase().includes(searchQuery.toLowerCase())
            : true,
        )
        .map((version) => version.id);
      setFilteredVersions(filtered);
    }
  }, [minecraftVersions, selectedVersionType, searchQuery]);

  useEffect(() => {
    async function fetchLoaderVersions() {
      if (!editedProfile.game_version || editedProfile.loader === "vanilla") {
        setLoaderVersions([]);
        return;
      }

      try {
        setIsLoadingLoaderVersions(true);
        setError(null);
        let versions: string[] = [];

        switch (editedProfile.loader) {
          case "fabric":
            const fabricResult = await invoke<{ loader: { version: string } }[]>(
              "get_fabric_loader_versions",
              {
                minecraftVersion: editedProfile.game_version,
              },
            );
            versions = fabricResult.map((v) => v.loader.version);
            break;
          case "forge":
            versions = await invoke<string[]>("get_forge_versions", {
              minecraftVersion: editedProfile.game_version,
            });
            break;
          case "quilt":
            const quiltResult = await invoke<{ loader: { version: string } }[]>(
              "get_quilt_loader_versions",
              {
                minecraftVersion: editedProfile.game_version,
              },
            );
            versions = quiltResult.map((v) => v.loader.version);
            break;
          case "neoforge":
            versions = await invoke<string[]>("get_neoforge_versions", {
              minecraftVersion: editedProfile.game_version,
            });
            break;
        }

        setLoaderVersions(versions);
      } catch (err) {
        console.error(`Failed to fetch ${editedProfile.loader} versions:`, err);
        setError(
          `failed to fetch ${editedProfile.loader} versions: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setIsLoadingLoaderVersions(false);
      }
    }

    fetchLoaderVersions();
  }, [editedProfile.game_version, editedProfile.loader]);

  function isModLoaderCompatible(
    loader: string,
    minecraftVersion: string,
  ): boolean {
    if (loader === "vanilla") return true;

    switch (loader) {
      case "fabric":
        return isVersionNewerOrEqual(minecraftVersion, "1.14");
      case "forge":
        return true;
      case "quilt":
        return isVersionNewerOrEqual(minecraftVersion, "1.14");
      case "neoforge":
        return isVersionNewerOrEqual(minecraftVersion, "1.20.1");
      default:
        return false;
    }
  }

  function isVersionNewerOrEqual(
    version: string,
    baseVersion: string,
  ): boolean {
    const parseVersion = (v: string) => {
      const parts = v.split(".");
      return {
        major: Number.parseInt(parts[0]) || 0,
        minor: Number.parseInt(parts[1]) || 0,
        patch: Number.parseInt(parts[2]) || 0,
      };
    };

    const v1 = parseVersion(version);
    const v2 = parseVersion(baseVersion);

    if (v1.major !== v2.major) return v1.major > v2.major;
    if (v1.minor !== v2.minor) return v1.minor > v2.minor;
    return v1.patch >= v2.patch;
  }

  const handleVersionTypeClick = (type: VersionType) => {
    if (selectedVersionType !== type) {
      setSelectedVersionType(type);
      if (isBackgroundAnimationEnabled && versionTypesRef.current) {
        const activeButton = versionTypesRef.current.querySelector(
          `.version-type-${type}`,
        );
        const allButtons = versionTypesRef.current.querySelectorAll("button");

        if (activeButton) {
          gsap.to(activeButton, {
            backgroundColor: `${accentColor.value}40`,
            borderColor: accentColor.value,
            color: "#ffffff",
            duration: 0.3,
            ease: "power2.out",
          });
        }

        allButtons.forEach((button) => {
          if (button !== activeButton) {
            gsap.to(button, {
              backgroundColor: "rgba(255,255,255,0.05)",
              borderColor: "rgba(255,255,255,0.1)",
              color: "rgba(255,255,255,0.7)",
              duration: 0.3,
              ease: "power2.out",
            });
          }
        });
      }
    }
  };

  const handleGameVersionClick = (versionId: string) => {
    updateProfile({ game_version: versionId, loader_version: null });
    if (isBackgroundAnimationEnabled) {
      scrollToPlatforms();
    }
  };

  const handleLoaderClick = (loaderName: string) => {
    const newLoader = (
      editedProfile.loader === loaderName ? "vanilla" : loaderName
    ) as ModLoader;
    updateProfile({ loader: newLoader, loader_version: null });

    if (newLoader !== "vanilla" && isBackgroundAnimationEnabled) {
      scrollToLoaderVersion();
    }
  };

  const scrollToPlatforms = () => {
    if (!platformsRef.current || !scrollContainerRef.current) return;
    if (isBackgroundAnimationEnabled) {
      gsap.to(scrollContainerRef.current, {
        duration: 0.5,
        scrollTo: {
          y:
            platformsRef.current.offsetTop -
            scrollContainerRef.current.offsetTop -
            20,
          autoKill: true,
        },
        ease: "power2.out",
      });
      gsap.fromTo(
        platformsRef.current,
        { scale: 0.98, opacity: 0.5 },
        { scale: 1, opacity: 1, duration: 0.4, ease: "power2.out" },
      );
    }
  };

  const scrollToLoaderVersion = () => {
    if (!loaderVersionRef.current || !scrollContainerRef.current) return;
    if (isBackgroundAnimationEnabled) {
      gsap.to(scrollContainerRef.current, {
        duration: 0.5,
        scrollTo: {
          y:
            loaderVersionRef.current.offsetTop -
            scrollContainerRef.current.offsetTop -
            20,
          autoKill: true,
        },
        ease: "power2.out",
      });
      gsap.fromTo(
        loaderVersionRef.current,
        { scale: 0.98, opacity: 0.5 },
        { scale: 1, opacity: 1, duration: 0.4, ease: "power2.out" },
      );
    }
  };

  const handleRepair = async () => {
    try {
      setIsRepairing(true);
      setError(null);
      
      await ProfileService.repairProfile(profile.id);
      
      toast.success("Profile repair completed successfully!");
    } catch (err) {
      console.error("Failed to repair profile:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to repair profile: ${errorMessage}`);
      toast.error(`Failed to repair profile: ${errorMessage}`);
    } finally {
      setIsRepairing(false);
    }
  };

  return (
    <div ref={tabRef} className="space-y-6 select-none">
      {error && <StatusMessage type="error" message={error} />}

      <div ref={currentInstallRef} className="space-y-4">
        <div>
          <h3 className="text-3xl font-minecraft text-white mb-3 lowercase">
            currently installed
          </h3>
          <Card
            variant="flat"
            className="p-4 flex items-center justify-between border border-white/10 bg-black/20"
          >
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 flex items-center justify-center rounded-md border"
                style={{
                  backgroundColor: `${accentColor.value}30`,
                  borderColor: `${accentColor.value}60`,
                }}
              >
                <Icon icon="solar:widget-bold" className="w-7 h-7 text-white" />
              </div>
              <div>
                <div className="text-2xl text-white font-minecraft tracking-wide lowercase">
                  minecraft {editedProfile.game_version}
                </div>
                <div className="text-xl text-white/70 tracking-wide lowercase">
                  {editedProfile.loader === "vanilla"
                    ? "vanilla"
                    : `${editedProfile.loader} ${editedProfile.loader_version || ""}`}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <div ref={versionTypesRef} className="space-y-4">
        <div>
          <h3 className="text-3xl font-minecraft text-white mb-3 lowercase">
            version type
          </h3>
          <div className="flex flex-wrap">
            {["release", "snapshot", "old-beta", "old-alpha"].map((type) => (
              <Button
                key={type}
                variant={selectedVersionType === type ? "default" : "ghost"}
                size="sm"
                className={cn(
                  "mr-2 mb-2 text-xl version-type-" + type,
                  selectedVersionType === type
                    ? "bg-accent/20 border-accent text-white"
                    : "bg-black/20 hover:bg-black/30 border-white/10 text-white/80",
                )}
                onClick={() => handleVersionTypeClick(type as VersionType)}
              >
                {type}
              </Button>
            ))}
          </div>
        </div>

        <div ref={versionsRef}>
          <h3 className="text-3xl font-minecraft text-white mb-3 lowercase">
            game version
          </h3>
          <div className="mb-3">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="search versions..."
              className="w-full text-2xl py-3"
              variant="flat"
            />
          </div>

          <div className="flex-1 relative">
            {isLoadingVersions ? (
              <Card
                variant="flat"
                className="p-4 text-white/70 text-center border border-white/10 bg-black/20"
              >
                <div className="flex items-center justify-center">
                  <Icon
                    icon="solar:refresh-bold"
                    className="w-6 h-6 mr-2 animate-spin"
                  />
                  <span className="font-minecraft text-2xl">
                    loading versions...
                  </span>
                </div>
              </Card>
            ) : (
              <Card
                variant="flat"
                className="max-h-48 overflow-y-auto custom-scrollbar border border-white/10 bg-black/20"
              >
                {filteredVersions.length === 0 ? (
                  <div className="p-4 text-2xl text-white/70 text-center select-none">
                    no versions found matching your search
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 p-3">
                    {filteredVersions.map((version) => (
                      <Button
                        key={version}
                        variant={
                          editedProfile.game_version === version
                            ? "default"
                            : "ghost"
                        }
                        size="sm"
                        className={cn(
                          "text-center text-xl w-full",
                          editedProfile.game_version === version
                            ? "bg-accent/20 border-accent text-white"
                            : "bg-black/20 hover:bg-black/30 border-white/10 text-white/80 hover:text-white",
                        )}
                        onClick={() => handleGameVersionClick(version)}
                      >
                        {version}
                      </Button>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </div>
        </div>
      </div>

      <div ref={platformsRef} className="space-y-4">
        <div>
          <h3 className="text-3xl font-minecraft text-white mb-3 lowercase">
            platform
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {[
              { name: "vanilla", icon: "/icons/minecraft.png" },
              { name: "fabric", icon: "/icons/fabric.png" },
              { name: "forge", icon: "/icons/forge.png" },
              { name: "quilt", icon: "/icons/quilt.png" },
              { name: "neoforge", icon: "/icons/neoforge.png" },
            ].map((loader) => {
              const isCompatible = isModLoaderCompatible(
                loader.name,
                editedProfile.game_version,
              );
              const isSelected = editedProfile.loader === loader.name;

              return (
                <Card
                  key={loader.name}
                  variant={isSelected ? "flat" : "flat-secondary"}
                  className={cn(
                    "p-3 flex flex-col items-center justify-center cursor-pointer platform-${loader.name}",
                    isSelected
                      ? "bg-black/30 grayscale-0 text-white"
                      : isCompatible
                        ? "bg-black/20 text-white/70 border-white/10 hover:bg-black/30 hover:text-white hover:border-white/20"
                        : "bg-black/10 text-white/30 border-white/10 cursor-not-allowed",
                  )}
                  onClick={() => isCompatible && handleLoaderClick(loader.name)}
                >
                  <img
                    src={loader.icon || "/placeholder.svg"}
                    alt={loader.name}
                    className="w-10 h-10 mb-2 object-contain"
                    style={{ opacity: isCompatible ? 1 : 0.5 }}
                  />
                  <span className="font-minecraft text-xl lowercase">
                    {loader.name}
                  </span>
                  {!isCompatible && (
                    <span className="text-lg text-white/50 mt-1">
                      not compatible
                    </span>
                  )}
                </Card>
              );
            })}
          </div>
        </div>

        {editedProfile.loader !== "vanilla" && (
          <div ref={loaderVersionRef}>
            <h3 className="text-3xl font-minecraft text-white mb-3 lowercase">{`${editedProfile.loader} version`}</h3>
            {isLoadingLoaderVersions ? (
              <Card
                variant="flat"
                className="p-4 text-white/70 text-center border border-white/10 bg-black/20"
              >
                <div className="flex items-center justify-center">
                  <Icon
                    icon="solar:refresh-bold"
                    className="w-6 h-6 mr-2 animate-spin"
                  />
                  <span className="font-minecraft text-2xl">
                    loading {editedProfile.loader} versions...
                  </span>
                </div>
              </Card>
            ) : loaderVersions.length > 0 ? (
              <Select
                value={editedProfile.loader_version || ""}
                onChange={(value) => updateProfile({ loader_version: value })}
                options={[
                  { value: "", label: "select a version" },
                  ...loaderVersions.map((version) => ({
                    value: version,
                    label: version,
                  })),
                ]}
                className="text-2xl py-3"
                variant="flat"
              />
            ) : (
              <Card
                variant="flat"
                className="p-4 text-2xl text-white/70 text-center select-none border border-white/10 bg-black/20"
              >
                no {editedProfile.loader} versions available for minecraft{" "}
                {editedProfile.game_version}
              </Card>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <h3 className="text-3xl font-minecraft text-white mb-3 lowercase">
            repair profile
          </h3>
          <Card
            variant="flat"
            className="p-4 border border-white/10 bg-black/20"
          >
            <div className="flex flex-col space-y-3">
              <p className="text-xs text-white/70 font-minecraft-ten tracking-wide select-none">
                Repairs the profile installation by redownloading missing or corrupted files.
              </p>
              <Button
                onClick={handleRepair}
                disabled={isRepairing || isLoadingVersions || isLoadingLoaderVersions}
                variant="secondary"
                icon={
                  isRepairing ? (
                    <Icon
                      icon="solar:refresh-bold"
                      className="w-5 h-5 animate-spin text-white"
                    />
                  ) : (
                    <Icon icon="solar:shield-check-bold" className="w-5 h-5 text-white" />
                  )
                }
                size="md"
                className="text-2xl w-fit"
              >
                {isRepairing ? "repairing..." : "repair profile"}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
