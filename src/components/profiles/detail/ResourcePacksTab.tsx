"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { Profile } from "../../../types/profile";
import type {
  ModrinthVersion,
  ResourcePackInfo,
} from "../../../types/modrinth";
import { ContentPackRow } from "./ContentPackRow";
import { SearchInput } from "../../ui/SearchInput";
import { LoadingState } from "../../ui/LoadingState";
import { EmptyState } from "../../ui/EmptyState";
import { Icon } from "@iconify/react";
import { formatFileSize } from "../../../utils/format-file-size";
import { useThemeStore } from "../../../store/useThemeStore";
import { ContentTable } from "../../ui/ContentTable";
import { Button } from "../../ui/buttons/Button";
import { gsap } from "gsap";

interface ResourcePacksTabProps {
  profile: Profile;
  onRefresh?: () => void;
  isActive?: boolean;
  searchQuery?: string;
  onBrowse?: (contentType: string) => void;
}

export function ResourcePacksTab({
  profile,
  onRefresh,
  isActive = false,
  searchQuery = "",
}: ResourcePacksTabProps) {
  const { t } = useTranslation();
  const [resourcePacks, setResourcePacks] = useState<ResourcePackInfo[]>([]);
  const [selectedPacks, setSelectedPacks] = useState<Set<string>>(new Set());
  const [loadingResourcePacks, setLoadingResourcePacks] = useState(false);
  const [resourcePacksError, setResourcePacksError] = useState<string | null>(
    null,
  );
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "enabled">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [loadingOperation, setLoadingOperation] = useState(false);
  const [resourcePackUpdates, setResourcePackUpdates] = useState<
    Record<string, ModrinthVersion>
  >({});
  const [updatingPacks, setUpdatingPacks] = useState<Set<string>>(new Set());
  const [lastUpdateCheck, setLastUpdateCheck] = useState<number>(0);
  const accentColor = useThemeStore((state) => state.accentColor);
  const containerRef = useRef<HTMLDivElement>(null);

  // Use parent's search query if provided
  useEffect(() => {
    if (searchQuery !== undefined) {
      setLocalSearchQuery(searchQuery);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (containerRef.current && isActive) {
      gsap.fromTo(
        containerRef.current,
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          ease: "power2.out",
        },
      );
    }
  }, [isActive]);

  const fetchResourcePacks = async () => {
    setLoadingResourcePacks(true);
    setResourcePacksError(null);

    try {
      const packs = await invoke<ResourcePackInfo[]>(
        "get_local_resourcepacks",
        {
          profileId: profile.id,
        },
      );

      console.log("Raw resource packs data:", packs);

      const processedPacks = (packs || []).map((pack) => {
        let fileName = pack.filename;
        if (!fileName || fileName === "0") {
          if (pack.path) {
            const parts = pack.path.split(/[/\\]/);
            fileName = parts[parts.length - 1] || "Unknown file";
          } else {
            fileName = "Unknown file";
          }
        }

        return {
          ...pack,
          file_name: fileName,
        };
      });

      setResourcePacks(processedPacks);

      if (processedPacks.length > 0) {
        checkForResourcePackUpdates();
      }

      if (onRefresh) onRefresh();
    } catch (error) {
      console.error("Failed to load resource packs:", error);
      setResourcePacksError(
        `Failed to load resource packs: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setLoadingResourcePacks(false);
    }
  };

  const checkForResourcePackUpdates = async () => {
    const now = Date.now();
    if (now - lastUpdateCheck < 30000 && lastUpdateCheck > 0) {
      console.debug(
        "[ResourcePacksTab] Skipping update check, last check was less than 30 seconds ago",
      );
      return;
    }

    if (!profile.game_version) {
      console.debug(
        "[ResourcePacksTab] Cannot check resource pack updates without game_version.",
      );
      return;
    }

    setCheckingUpdates(true);
    setUpdateError(null);

    try {
      const packsWithHashes = resourcePacks.filter(
        (pack) => pack.modrinth_info && pack.sha1_hash,
      );

      console.debug(
        "[ResourcePacksTab] Packs eligible for resource pack update check:",
        packsWithHashes,
      );

      if (packsWithHashes.length === 0) {
        console.debug(
          "[ResourcePacksTab] No resource packs eligible for update check.",
        );
        setCheckingUpdates(false);
        return;
      }

      const hashes = packsWithHashes
        .map((pack) => pack.sha1_hash!)
        .filter((hash) => hash);

      if (hashes.length === 0) {
        console.debug(
          "[ResourcePacksTab] No valid hashes found for resource pack update check.",
        );
        setCheckingUpdates(false);
        return;
      }

      const request = {
        hashes,
        algorithm: "sha1",
        loaders: [],
        game_versions: [profile.game_version],
      };

      console.debug(
        "[ResourcePacksTab] Checking for updates for resource packs with request:",
        request,
      );

      const updates = await invoke<Record<string, ModrinthVersion>>(
        "check_modrinth_updates",
        { request },
      );

      console.debug(
        "[ResourcePacksTab] Received raw resource pack updates from backend:",
        updates,
      );

      setResourcePackUpdates(updates);
      setLastUpdateCheck(now);
      console.log(
        `[ResourcePacksTab] Found updates for ${Object.keys(updates).length} resource packs`,
      );
    } catch (error) {
      console.error("Error checking for resource pack updates:", error);
      setUpdateError(
        error instanceof Error
          ? error.message
          : "Error checking for resource pack updates",
      );
      setResourcePackUpdates({});
    } finally {
      setCheckingUpdates(false);
    }
  };

  function hasResourcePackUpdate(pack: ResourcePackInfo): boolean {
    if (!pack.sha1_hash || !pack.modrinth_info) return false;

    const updateVersion =
      pack.sha1_hash in resourcePackUpdates
        ? resourcePackUpdates[pack.sha1_hash]
        : null;
    if (!updateVersion) return false;

    return updateVersion.id !== pack.modrinth_info.version_id;
  }

  function getResourcePackUpdateVersion(
    pack: ResourcePackInfo,
  ): ModrinthVersion | null {
    if (!pack.sha1_hash || !(pack.sha1_hash in resourcePackUpdates))
      return null;

    const updateVersion = resourcePackUpdates[pack.sha1_hash];

    if (
      pack.modrinth_info &&
      updateVersion.id === pack.modrinth_info.version_id
    ) {
      return null;
    }

    return updateVersion;
  }

  useEffect(() => {
    fetchResourcePacks();
  }, [profile.id]);

  useEffect(() => {
    if (isActive && resourcePacks.length > 0) {
      checkForResourcePackUpdates();
    }
  }, [isActive, resourcePacks.length]);

  const togglePackEnabled = async (packId: string) => {
    if (loadingOperation) return;

    const pack = resourcePacks.find((p) => p.filename === packId);
    if (!pack || !pack.path) return;

    setLoadingOperation(true);

    try {
      const shouldBeEnabled = pack.is_disabled === true;

      console.log(
        `Toggling pack ${pack.filename}, currently disabled: ${pack.is_disabled}, setting enabled to: ${shouldBeEnabled}`,
      );

      await invoke("set_file_enabled", {
        filePath: pack.path,
        enabled: shouldBeEnabled,
      });

      setResourcePacks((packs) =>
        packs.map((p) =>
          p.filename === packId ? { ...p, is_disabled: !shouldBeEnabled } : p,
        ),
      );

      fetchResourcePacks();
    } catch (err) {
      console.error("Failed to toggle pack enabled state:", err);
      setResourcePacksError(
        `Failed to toggle pack: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoadingOperation(false);
    }
  };

  const updatePack = async (packId: string) => {
    if (loadingOperation) return;

    const pack = resourcePacks.find((p) => p.filename === packId);
    if (!pack || !hasResourcePackUpdate(pack)) return;

    const updateVersion = getResourcePackUpdateVersion(pack);
    if (!updateVersion) {
      console.error(
        "Update version not found despite hasResourcePackUpdate returning true",
      );
      return;
    }

    setUpdatingPacks((prev) => new Set(prev).add(packId));

    try {
      console.log(
        `Updating resource pack ${pack.filename} to version ${updateVersion.version_number}`,
      );

      if (pack.sha1_hash && pack.sha1_hash in resourcePackUpdates) {
        const newUpdates = { ...resourcePackUpdates };
        delete newUpdates[pack.sha1_hash];
        setResourcePackUpdates(newUpdates);
      }

      await invoke("update_resourcepack_from_modrinth", {
        profileId: profile.id,
        resourcepack: pack,
        newVersionDetails: updateVersion,
      });

      console.log(
        `Successfully updated resource pack ${pack.filename} to version ${updateVersion.version_number}`,
      );

      fetchResourcePacks();
    } catch (err) {
      console.error("Failed to update pack:", err);
      setResourcePacksError(
        `Failed to update pack: ${err instanceof Error ? err.message : String(err)}`,
      );

      setResourcePackUpdates({ ...resourcePackUpdates });
    } finally {
      setUpdatingPacks((prev) => {
        const updated = new Set(prev);
        updated.delete(packId);
        return updated;
      });
    }
  };

  const updateAllPacks = async () => {
    const packsToUpdate = resourcePacks.filter((pack) =>
      hasResourcePackUpdate(pack),
    );
    if (packsToUpdate.length === 0 || loadingOperation) return;

    setLoadingOperation(true);

    setUpdatingPacks(new Set(packsToUpdate.map((pack) => pack.filename)));

    try {
      for (const pack of packsToUpdate) {
        const updateVersion = getResourcePackUpdateVersion(pack);
        if (!updateVersion) continue;

        try {
          console.log(
            `Updating resource pack ${pack.filename} to version ${updateVersion.version_number}`,
          );

          await invoke("update_resourcepack_from_modrinth", {
            profileId: profile.id,
            resourcepack: pack,
            newVersionDetails: updateVersion,
          });

          console.log(
            `Successfully updated resource pack ${pack.filename} to version ${updateVersion.version_number}`,
          );

          if (pack.sha1_hash) {
            const newUpdates = { ...resourcePackUpdates };
            delete newUpdates[pack.sha1_hash];
            setResourcePackUpdates(newUpdates);
          }

          setUpdatingPacks((prev) => {
            const updated = new Set(prev);
            updated.delete(pack.filename);
            return updated;
          });
        } catch (err) {
          console.error(`Failed to update ${pack.filename}:`, err);
        }
      }

      fetchResourcePacks();
    } catch (err) {
      console.error("Failed to update all packs:", err);
      setResourcePacksError(
        `Failed to update all packs: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoadingOperation(false);
      setUpdatingPacks(new Set());
    }
  };

  const deletePack = async (packId: string) => {
    if (loadingOperation) return;

    const pack = resourcePacks.find((p) => p.filename === packId);
    if (!pack || !pack.path) return;

    if (
      !confirm(
        `Are you sure you want to delete "${pack.filename}"? This cannot be undone.`,
      )
    ) {
      return;
    }

    setLoadingOperation(true);

    try {
      await invoke("delete_file", {
        filePath: pack.path,
      });

      setResourcePacks((packs) => packs.filter((p) => p.filename !== packId));
      setSelectedPacks((prev) => {
        const updated = new Set(prev);
        updated.delete(packId);
        return updated;
      });

      fetchResourcePacks();
    } catch (err) {
      console.error("Failed to delete pack:", err);
      setResourcePacksError(
        `Failed to delete pack: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoadingOperation(false);
    }
  };

  const openPackDirectory = async (path: string) => {
    if (loadingOperation) return;
    setLoadingOperation(true);

    try {
      await invoke("open_file_directory", {
        filePath: path,
      });
    } catch (err) {
      console.error("Failed to open directory:", err);
      setResourcePacksError(
        `Failed to open directory: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoadingOperation(false);
    }
  };

  const enableSelectedPacks = async () => {
    if (selectedPacks.size === 0 || loadingOperation) return;
    setLoadingOperation(true);

    try {
      const promises = Array.from(selectedPacks).map(async (packId) => {
        const pack = resourcePacks.find((p) => p.filename === packId);
        if (!pack || !pack.path || !pack.is_disabled) return;

        return invoke("set_file_enabled", {
          filePath: pack.path,
          enabled: true,
        });
      });

      await Promise.all(promises);

      fetchResourcePacks();
    } catch (err) {
      console.error("Failed to enable selected packs:", err);
      setResourcePacksError(
        `Failed to enable selected packs: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoadingOperation(false);
    }
  };

  const disableSelectedPacks = async () => {
    if (selectedPacks.size === 0 || loadingOperation) return;
    setLoadingOperation(true);

    try {
      const promises = Array.from(selectedPacks).map(async (packId) => {
        const pack = resourcePacks.find((p) => p.filename === packId);
        if (!pack || !pack.path || pack.is_disabled) return;

        return invoke("set_file_enabled", {
          filePath: pack.path,
          enabled: false,
        });
      });

      await Promise.all(promises);

      fetchResourcePacks();
    } catch (err) {
      console.error("Failed to disable selected packs:", err);
      setResourcePacksError(
        `Failed to disable selected packs: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoadingOperation(false);
    }
  };

  const deleteSelectedPacks = async () => {
    if (selectedPacks.size === 0 || loadingOperation) return;

    if (
      !confirm(
        `Are you sure you want to delete ${selectedPacks.size} selected resource pack${
          selectedPacks.size !== 1 ? "s" : ""
        }? This cannot be undone.`,
      )
    ) {
      return;
    }

    setLoadingOperation(true);

    try {
      const promises = Array.from(selectedPacks).map(async (packId) => {
        const pack = resourcePacks.find((p) => p.filename === packId);
        if (!pack || !pack.path) return;

        return invoke("delete_file", {
          filePath: pack.path,
        });
      });

      await Promise.all(promises);

      setResourcePacks((packs) =>
        packs.filter((p) => !selectedPacks.has(p.filename)),
      );
      setSelectedPacks(new Set());

      fetchResourcePacks();
    } catch (err) {
      console.error("Failed to delete selected packs:", err);
      setResourcePacksError(
        `Failed to delete selected packs: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoadingOperation(false);
    }
  };

  const handleSelectPack = (packId: string) => {
    setSelectedPacks((prev) => {
      const updated = new Set(prev);
      if (updated.has(packId)) {
        updated.delete(packId);
      } else {
        updated.add(packId);
      }
      return updated;
    });
  };

  const handleSelectAll = () => {
    if (selectedPacks.size === filteredPacks.length) {
      setSelectedPacks(new Set());
    } else {
      setSelectedPacks(new Set(filteredPacks.map((pack) => pack.filename)));
    }
  };

  const handleSort = (criteria: string) => {
    if (sortBy === criteria) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortBy(criteria as any);
      setSortDirection("asc");
    }
  };

  const effectiveSearchQuery = searchQuery || localSearchQuery;

  const filteredPacks = resourcePacks.filter((pack) =>
    pack.filename.toLowerCase().includes(effectiveSearchQuery.toLowerCase()),
  );

  const sortedPacks = [...filteredPacks].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "name":
        comparison = a.filename.localeCompare(b.filename);
        break;
      case "enabled":
        comparison =
          Number(a.is_disabled === true) - Number(b.is_disabled === true);
        break;
    }

    return sortDirection === "asc" ? comparison : -comparison;
  });

  const enabledPacks = filteredPacks.filter(
    (p) => p.is_disabled !== true,
  ).length;

  const packsWithUpdates = resourcePacks.filter((pack) =>
    hasResourcePackUpdate(pack),
  ).length;

  return (
    <div ref={containerRef} className="h-full flex flex-col select-none p-4">
      {/* Action bar with transparent styling */}
      <div
        className="flex items-center justify-between mb-4 p-3 rounded-lg border backdrop-blur-sm"
        style={{
          backgroundColor: `${accentColor.value}10`,
          borderColor: `${accentColor.value}30`,
        }}
      >
        {/* Only show search if parent isn't providing it */}
        {!searchQuery && (
          <div className="w-full md:w-1/3">
            <SearchInput
              value={localSearchQuery}
              onChange={setLocalSearchQuery}
              placeholder={t('resourcepacks.search_placeholder')}
            />
          </div>
        )}

        <div className="flex items-center gap-4 ml-auto">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={
                checkingUpdates ? (
                  <Icon icon="solar:refresh-bold" className="animate-spin" />
                ) : (
                  <Icon icon="solar:arrow-up-bold" />
                )
              }
              onClick={checkForResourcePackUpdates}
              disabled={checkingUpdates}
            >
              check updates
              {packsWithUpdates > 0 && (
                <span className="text-xl px-1.5 py-0.5 rounded-sm ml-1">
                  ({packsWithUpdates})
                </span>
              )}
            </Button>

            {packsWithUpdates > 0 && (
              <Button
                variant="success"
                size="sm"
                icon={
                  loadingOperation && updatingPacks.size > 0 ? (
                    <Icon icon="solar:refresh-bold" className="animate-spin" />
                  ) : (
                    <Icon icon="solar:download-bold" />
                  )
                }
                onClick={updateAllPacks}
                disabled={loadingOperation}
              >
                {loadingOperation && updatingPacks.size > 0
                  ? `updating (${updatingPacks.size}/${packsWithUpdates})`
                  : `update all (${packsWithUpdates})`}
              </Button>
            )}

            {selectedPacks.size > 0 && (
              <Button
                variant="destructive"
                size="sm"
                icon={<Icon icon="solar:trash-bin-trash-bold" />}
                onClick={deleteSelectedPacks}
              >
                delete ({selectedPacks.size})
              </Button>
            )}
          </div>
        </div>
      </div>

      {updateError && (
        <div
          className="p-3 flex items-center gap-2 mb-4 rounded-lg border backdrop-blur-sm"
          style={{
            backgroundColor: `rgba(220, 38, 38, 0.1)`,
            borderColor: `rgba(220, 38, 38, 0.3)`,
          }}
        >
          <Icon
            icon="solar:danger-triangle-bold"
            className="w-5 h-5 text-red-400"
          />
          <span className="text-white font-minecraft text-lg">
            Error checking for updates: {updateError}
          </span>
        </div>
      )}

      <div
        className="flex-1 min-h-0 overflow-hidden rounded-lg border backdrop-blur-sm"
        style={{
          backgroundColor: `${accentColor.value}08`,
          borderColor: `${accentColor.value}20`,
        }}
      >
        {loadingResourcePacks ? (
          <LoadingState message={t('resourcepacks.loading')} />
        ) : resourcePacksError ? (
          <div className="p-4 text-red-400 bg-red-900/20 rounded border border-red-700/30">
            <div className="flex items-center gap-2">
              <Icon icon="solar:danger-bold" className="w-5 h-5" />
              <span>{resourcePacksError}</span>
            </div>
            <button
              className="mt-2 px-3 py-1 bg-red-800/30 hover:bg-red-800/50 border border-red-700/30 rounded text-sm transition-colors"
              onClick={fetchResourcePacks}
            >
              Try Again
            </button>
          </div>
        ) : (
          <ContentTable
            headers={[
              {
                key: "name",
                label: "resource pack name",
                sortable: true,
                width: "flex-1",
                className: "px-3",
              },
              {
                key: "enabled",
                label: "status",
                sortable: true,
                width: "w-16",
                className: "text-center",
              },
              {
                key: "actions",
                label: "actions",
                sortable: false,
                width: "w-24",
                className: "text-center",
              },
            ]}
            sortKey={sortBy}
            sortDirection={sortDirection}
            onSort={handleSort}
            selectedCount={selectedPacks.size}
            totalCount={resourcePacks.length}
            filteredCount={filteredPacks.length}
            enabledCount={enabledPacks}
            onSelectAll={handleSelectAll}
            contentType="resource pack"
            searchQuery={effectiveSearchQuery}
          >
            {sortedPacks.length > 0 ? (
              sortedPacks.map((pack) => {
                const hasUpdate = hasResourcePackUpdate(pack);
                const updateVersion = hasUpdate
                  ? getResourcePackUpdateVersion(pack)
                  : null;
                const isUpdating = updatingPacks.has(pack.filename);

                return (
                  <ContentPackRow
                    key={pack.filename}
                    contentPack={{
                      id: pack.filename,
                      file_name: pack.filename,
                      filename: pack.filename,
                      enabled: !pack.is_disabled,
                      path: pack.path,
                      file_size: pack.file_size,
                      modrinth_info: pack.modrinth_info,
                      curseforge_info: pack.curseforge_info,
                      sha1_hash: pack.sha1_hash || "",
                      is_disabled: pack.is_disabled,
                      version: pack.modrinth_info?.version_number || pack.curseforge_info?.version_number,
                    }}
                    isSelected={selectedPacks.has(pack.filename)}
                    onSelect={() => handleSelectPack(pack.filename)}
                    onToggle={() => togglePackEnabled(pack.filename)}
                    onDelete={() => deletePack(pack.filename)}
                    onOpenDirectory={
                      pack.path
                        ? () => openPackDirectory(pack.path!)
                        : undefined
                    }
                    onUpdate={hasUpdate ? updatePack : undefined}
                    updateVersion={updateVersion}
                    checkingUpdates={checkingUpdates || isUpdating}
                    iconType="solar:image-gallery-bold"
                    formatFileSize={formatFileSize}
                    onCheckForUpdates={checkForResourcePackUpdates}
                  />
                );
              })
            ) : (
              <EmptyState
                icon="solar:gallery-bold"
                message={
                  effectiveSearchQuery
                    ? "no resource packs match your search"
                    : "no resource packs installed"
                }
                description="Drag and drop resource pack files here to install"
              />
            )}
          </ContentTable>
        )}
      </div>
    </div>
  );
}
