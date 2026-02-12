"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import type { ModLoader, Profile, ResolvedLoaderVersion } from "../../../types/profile";
import type { MinecraftVersion } from "../../../types/minecraft";
import { invoke } from "@tauri-apps/api/core";
import { StatusMessage } from "../../ui/StatusMessage";
import { useThemeStore } from "../../../store/useThemeStore";
import { SearchWithFilters } from "../../ui/SearchWithFilters";
import { Select } from "../../ui/Select";
import { Card } from "../../ui/Card";
import { Checkbox } from "../../ui/Checkbox";
import { gsap } from "gsap";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/buttons/Button";
import { useTranslation } from "react-i18next";

interface InstallationSettingsTabProps {
  profile: Profile;
  editedProfile: Profile;
  updateProfile: (updates: Partial<Profile>) => void;
  refreshTrigger?: number; // Increment this to trigger a refresh
}

type VersionType = "release" | "snapshot" | "old-beta" | "old-alpha";

export function InstallationSettingsTab({
  profile,
  editedProfile,
  updateProfile,
  refreshTrigger,
}: InstallationSettingsTabProps) {
  const { t } = useTranslation();
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

  const [resolvedLoaderVersion, setResolvedLoaderVersion] = useState<ResolvedLoaderVersion | null>(null);
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const tabRef = useRef<HTMLDivElement>(null);
  const currentInstallRef = useRef<HTMLDivElement>(null);
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
      // Convert filter value to API format (old-beta -> old_beta)
      const apiVersionType = selectedVersionType.replace('-', '_');

      const filtered = minecraftVersions
        .filter((version) => version.type === apiVersionType)
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

  useEffect(() => {
    async function fetchResolvedLoaderVersion() {
      if (!editedProfile.game_version || editedProfile.loader === "vanilla") {
        setResolvedLoaderVersion(null);
        return;
      }

      try {
        const resolved = await invoke<ResolvedLoaderVersion>("resolve_loader_version", {
          profileId: editedProfile.id,
          minecraftVersion: editedProfile.game_version,
        });
        setResolvedLoaderVersion(resolved);
      } catch (err) {
        console.error("Failed to resolve loader version:", err);
        setResolvedLoaderVersion(null);
      }
    }

    fetchResolvedLoaderVersion();
  }, [editedProfile.id, editedProfile.game_version, editedProfile.loader, editedProfile.loader_version, editedProfile.settings.use_overwrite_loader_version, editedProfile.settings.overwrite_loader_version, editedProfile.selected_norisk_pack_id]);

  // Separate function that can be called externally
  const fetchResolvedLoaderVersion = async () => {
    if (!editedProfile.game_version || editedProfile.loader === "vanilla") {
      setResolvedLoaderVersion(null);
      return;
    }

    try {
      const resolved = await invoke<ResolvedLoaderVersion>("resolve_loader_version", {
        profileId: editedProfile.id,
        minecraftVersion: editedProfile.game_version,
      });
      setResolvedLoaderVersion(resolved);
    } catch (err) {
      console.error("Failed to resolve loader version:", err);
      setResolvedLoaderVersion(null);
    }
  };

  // Effect to refresh when parent signals a save occurred
  useEffect(() => {
    if (refreshTrigger) {
      fetchResolvedLoaderVersion();
    }
  }, [refreshTrigger]);

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



  const getReasonText = (reason: string): string => {
    switch (reason) {
      case "norisk_pack":
        return t('profiles.settings.reasonNoriskPack');
      case "user_overwrite":
        return t('profiles.settings.reasonUserOverwrite');
      case "profile_default":
        return t('profiles.settings.reasonProfileDefault');
      case "not_resolved":
        return t('profiles.settings.reasonNotResolved');
      default:
        return reason;
    }
  };

  return (
    <div ref={tabRef} className="space-y-6 select-none">
      {error && <StatusMessage type="error" message={error} />}

      <div ref={currentInstallRef} className="space-y-4">
        <div>
          <div className="flex items-start justify-between gap-6">
            <div className="flex-1">
              <h3 className="text-3xl font-minecraft text-white mb-3 lowercase">
                {t('profiles.settings.currentlyInstalled')}
              </h3>
              <div className="flex items-center gap-3 text-sm font-minecraft-ten">
                {/* Minecraft Version */}
                <div className="text-white flex items-center gap-2">
                  <img
                    src="/icons/minecraft.png"
                    alt="Minecraft"
                    className="w-4 h-4 object-contain"
                  />
                  <span className="font-bold">{editedProfile.game_version}</span>
                </div>

                <div className="w-px h-4 bg-white/30"></div>

                {/* Loader Version */}
                <div className="text-white/70 flex items-center gap-2">
                  <img
                    src={
                      editedProfile.loader === "vanilla" ? "/icons/minecraft.png" :
                      editedProfile.loader === "fabric" ? "/icons/fabric.png" :
                      editedProfile.loader === "forge" ? "/icons/forge.png" :
                      editedProfile.loader === "quilt" ? "/icons/quilt.png" :
                      editedProfile.loader === "neoforge" ? "/icons/neoforge.png" :
                      "/icons/minecraft.png"
                    }
                    alt={editedProfile.loader || "Vanilla"}
                    className="w-4 h-4 object-contain"
                  />
                  <span>
                    {editedProfile.loader === "vanilla"
                      ? "Vanilla"
                      : `${editedProfile.loader} ${editedProfile.loader_version || ""}`.trim()}
                  </span>
                </div>
              </div>
            </div>


          </div>
        </div>
      </div>

      <div ref={versionsRef} className="space-y-4">
        <div>
          <h3 className="text-3xl font-minecraft text-white mb-3 lowercase">
            {t('profiles.settings.gameVersion')}
          </h3>
          <div className="mb-3">
            <SearchWithFilters
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              placeholder={t('profiles.settings.searchVersions')}
              className="w-full"
              showSort={false}
              showFilter={true}
              filterOptions={[
                { value: "release", label: t('profiles.settings.release'), icon: "solar:filter-bold" },
                { value: "snapshot", label: t('profiles.settings.snapshot'), icon: "solar:filter-bold" },
                { value: "old-beta", label: t('profiles.settings.oldBeta'), icon: "solar:filter-bold" },
                { value: "old-alpha", label: t('profiles.settings.oldAlpha'), icon: "solar:filter-bold" },
              ]}
              filterValue={selectedVersionType}
              onFilterChange={(value) => {
                const versionType = value as VersionType;
                handleVersionTypeClick(versionType);
              }}
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
                    {t('profiles.settings.loadingVersions')}
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
                    {t('profiles.settings.noVersionsFound')}
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
                          profile.is_standard_version && "cursor-not-allowed opacity-50"
                        )}
                        onClick={() => !profile.is_standard_version && handleGameVersionClick(version)}
                        disabled={profile.is_standard_version ? true : false}
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
            {t('profiles.settings.platform')}
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
                      {t('profiles.settings.notCompatible')}
                    </span>
                  )}
                </Card>
              );
            })}
          </div>
        </div>

        {editedProfile.loader !== "vanilla" && (
          <div ref={loaderVersionRef}>
            <h3 className="text-3xl font-minecraft text-white mb-3 lowercase">{t('profiles.settings.loaderVersion', { loader: editedProfile.loader })}</h3>
            
            {resolvedLoaderVersion && (
              <Card
                variant="flat"
                className="p-3 mb-4 border border-white/10 bg-black/20"
              >
                <div className="text-xs text-white/90 font-minecraft-ten">
                  {t('profiles.settings.currentLoaderVersion')}{" "}
                  <span className="text-white font-bold">
                    {resolvedLoaderVersion.version || t('profiles.settings.notSet')}
                  </span>
                  {resolvedLoaderVersion.reason !== "profile_default" && (
                    <span className="text-white/70 ml-2">
                      ({getReasonText(resolvedLoaderVersion.reason)})
                    </span>
                  )}
                </div>
              </Card>
            )}
            
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
                    {t('profiles.settings.loadingLoaderVersions', { loader: editedProfile.loader })}
                  </span>
                </div>
              </Card>
            ) : loaderVersions.length > 0 ? (
              <div className="space-y-4">
                <div className="space-y-3">
                  <Checkbox
                    checked={editedProfile.settings.use_overwrite_loader_version}
                    onChange={(e) => updateProfile({
                      settings: {
                        ...editedProfile.settings,
                        use_overwrite_loader_version: e.target.checked
                      }
                    })}
                    label={t('profiles.settings.useCustomLoaderVersion', { loader: editedProfile.loader.charAt(0).toUpperCase() + editedProfile.loader.slice(1) })}
                    size="md"
                  />
                  
                  <Select
                    value={editedProfile.settings.overwrite_loader_version || ""}
                    onChange={(value) => updateProfile({
                      settings: {
                        ...editedProfile.settings,
                        overwrite_loader_version: value
                      }
                    })}
                    options={[
                      { value: "", label: t('profiles.settings.selectCustomVersion') },
                      ...loaderVersions.map((version) => ({
                        value: version,
                        label: version,
                      })),
                    ]}
                    className="text-2xl py-3"
                    variant="flat"
                    disabled={!editedProfile.settings.use_overwrite_loader_version}
                  />
                </div>
              </div>
            ) : (
              <Card
                variant="flat"
                className="p-4 text-2xl text-white/70 text-center select-none border border-white/10 bg-black/20"
              >
                {t('profiles.settings.noLoaderVersions', { loader: editedProfile.loader, version: editedProfile.game_version })}
              </Card>
            )}
          </div>
        )}
      </div>


    </div>
  );
}
