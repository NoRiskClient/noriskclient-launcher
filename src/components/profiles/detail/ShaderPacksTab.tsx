"use client";

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Profile } from "../../../types/profile";
import type { ModrinthVersion, ShaderPackInfo } from "../../../types/modrinth";
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
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";

interface ShaderPacksTabProps {
  profile: Profile;
  onRefresh?: () => void;
  isActive?: boolean;
  searchQuery?: string;
  onBrowse?: (contentType: string) => void;
}

export function ShaderPacksTab({
  profile,
  onRefresh,
  isActive = false,
  searchQuery = "",
}: ShaderPacksTabProps) {
  const { t } = useTranslation();
  const [shaderPacks, setShaderPacks] = useState<ShaderPackInfo[]>([]);
  const [selectedPacks, setSelectedPacks] = useState<Set<string>>(new Set());
  const [loadingShaderPacks, setLoadingShaderPacks] = useState(false);
  const [shaderPacksError, setShaderPacksError] = useState<string | null>(null);
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "enabled">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [loadingOperation, setLoadingOperation] = useState(false);
  const [shaderPackUpdates, setShaderPackUpdates] = useState<
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

  const fetchShaderPacks = async () => {
    setLoadingShaderPacks(true);
    setShaderPacksError(null);

    try {
      const packs = await invoke<ShaderPackInfo[]>("get_local_shaderpacks", {
        profileId: profile.id,
      });

      console.log("Raw shader packs data:", packs);

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

      setShaderPacks(processedPacks);

      if (processedPacks.length > 0) {
        checkForShaderPackUpdates();
      }

      if (onRefresh) onRefresh();
    } catch (error) {
      console.error("Failed to load shader packs:", error);
      setShaderPacksError(
        `Failed to load shader packs: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setLoadingShaderPacks(false);
    }
  };

  const checkForShaderPackUpdates = async () => {
    const now = Date.now();
    if (now - lastUpdateCheck < 30000 && lastUpdateCheck > 0) {
      console.debug(
        "[ShaderPacksTab] Skipping update check, last check was less than 30 seconds ago",
      );
      return;
    }

    if (!profile.game_version) {
      console.debug(
        "[ShaderPacksTab] Cannot check shader pack updates without game_version.",
      );
      return;
    }

    setCheckingUpdates(true);
    setUpdateError(null);

    try {
      const packsWithHashes = shaderPacks.filter(
        (pack) => pack.modrinth_info && pack.sha1_hash,
      );

      console.debug(
        "[ShaderPacksTab] Packs eligible for shader pack update check:",
        packsWithHashes,
      );

      if (packsWithHashes.length === 0) {
        console.debug(
          "[ShaderPacksTab] No shader packs eligible for update check.",
        );
        setCheckingUpdates(false);
        return;
      }

      const hashes = packsWithHashes
        .map((pack) => pack.sha1_hash!)
        .filter((hash) => hash);

      if (hashes.length === 0) {
        console.debug(
          "[ShaderPacksTab] No valid hashes found for shader pack update check.",
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
        "[ShaderPacksTab] Checking for updates for shader packs with request:",
        request,
      );

      const updates = await invoke<Record<string, ModrinthVersion>>(
        "check_modrinth_updates",
        { request },
      );

      console.debug(
        "[ShaderPacksTab] Received raw shader pack updates from backend:",
        updates,
      );

      setShaderPackUpdates(updates);
      setLastUpdateCheck(now);
      console.log(
        `[ShaderPacksTab] Found updates for ${Object.keys(updates).length} shader packs`,
      );
    } catch (error) {
      console.error("Error checking for shader pack updates:", error);
      setUpdateError(
        error instanceof Error
          ? error.message
          : "Error checking for shader pack updates",
      );
      setShaderPackUpdates({});
    } finally {
      setCheckingUpdates(false);
    }
  };

  function hasShaderPackUpdate(pack: ShaderPackInfo): boolean {
    if (!pack.sha1_hash || !pack.modrinth_info) return false;

    const updateVersion =
      pack.sha1_hash in shaderPackUpdates
        ? shaderPackUpdates[pack.sha1_hash]
        : null;
    if (!updateVersion) return false;

    return updateVersion.id !== pack.modrinth_info.version_id;
  }

  function getShaderPackUpdateVersion(
    pack: ShaderPackInfo,
  ): ModrinthVersion | null {
    if (!pack.sha1_hash || !(pack.sha1_hash in shaderPackUpdates)) return null;

    const updateVersion = shaderPackUpdates[pack.sha1_hash];

    if (
      pack.modrinth_info &&
      updateVersion.id === pack.modrinth_info.version_id
    ) {
      return null;
    }

    return updateVersion;
  }

  useEffect(() => {
    fetchShaderPacks();
  }, [profile.id]);

  useEffect(() => {
    if (isActive && shaderPacks.length > 0) {
      checkForShaderPackUpdates();
    }
  }, [isActive, shaderPacks.length]);

  const togglePackEnabled = async (packId: string) => {
    if (loadingOperation) return;

    const pack = shaderPacks.find((p) => p.filename === packId);
    if (!pack || !pack.path) return;

    setLoadingOperation(true);

    try {
      const shouldBeEnabled = pack.is_disabled === true;
      const packFileName = pack.filename || "Selected pack";

      console.log(
        `Toggling pack ${pack.filename}, currently disabled: ${pack.is_disabled}, setting enabled to: ${shouldBeEnabled}`,
      );

      await invoke("set_file_enabled", {
        filePath: pack.path,
        enabled: shouldBeEnabled,
      });

      toast.success(t('shaderpacks.toggle_success', { name: packFileName, status: shouldBeEnabled ? t('common.enabled').toLowerCase() : t('common.disabled').toLowerCase() }));

      setShaderPacks((packs) =>
        packs.map((p) =>
          p.filename === packId ? { ...p, is_disabled: !shouldBeEnabled } : p,
        ),
      );

      fetchShaderPacks();
    } catch (err) {
      const packFileName = pack?.filename || "Selected pack";
      console.error("Failed to toggle pack enabled state:", err);
      toast.error(t('shaderpacks.toggle_failed', { name: packFileName, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setLoadingOperation(false);
    }
  };

  const updatePack = async (packId: string) => {
    if (loadingOperation) return;

    const pack = shaderPacks.find((p) => p.filename === packId);
    if (!pack || !hasShaderPackUpdate(pack)) return;

    const updateVersion = getShaderPackUpdateVersion(pack);
    if (!updateVersion) {
      console.error(
        "Update version not found despite hasShaderPackUpdate returning true",
      );
      return;
    }

    setUpdatingPacks((prev) => new Set(prev).add(packId));

    try {
      console.log(
        `Updating shader pack ${pack.filename} to version ${updateVersion.version_number}`,
      );

      if (pack.sha1_hash && pack.sha1_hash in shaderPackUpdates) {
        const newUpdates = { ...shaderPackUpdates };
        delete newUpdates[pack.sha1_hash];
        setShaderPackUpdates(newUpdates);
      }

      await invoke("update_shaderpack_from_modrinth", {
        profileId: profile.id,
        shaderpack: pack,
        newVersionDetails: updateVersion,
      });

      console.log(
        `Successfully updated shader pack ${pack.filename} to version ${updateVersion.version_number}`,
      );

      fetchShaderPacks();
    } catch (err) {
      console.error("Failed to update pack:", err);
      setShaderPacksError(
        `Failed to update pack: ${err instanceof Error ? err.message : String(err)}`,
      );

      setShaderPackUpdates({ ...shaderPackUpdates });
    } finally {
      setUpdatingPacks((prev) => {
        const updated = new Set(prev);
        updated.delete(packId);
        return updated;
      });
    }
  };

  const updateAllPacks = async () => {
    const packsToUpdate = shaderPacks.filter((pack) =>
      hasShaderPackUpdate(pack),
    );
    if (packsToUpdate.length === 0 || loadingOperation) return;

    setLoadingOperation(true);

    setUpdatingPacks(new Set(packsToUpdate.map((pack) => pack.filename)));

    try {
      for (const pack of packsToUpdate) {
        const updateVersion = getShaderPackUpdateVersion(pack);
        if (!updateVersion) continue;

        try {
          console.log(
            `Updating shader pack ${pack.filename} to version ${updateVersion.version_number}`,
          );

          await invoke("update_shaderpack_from_modrinth", {
            profileId: profile.id,
            shaderpack: pack,
            newVersionDetails: updateVersion,
          });

          console.log(
            `Successfully updated shader pack ${pack.filename} to version ${updateVersion.version_number}`,
          );

          if (pack.sha1_hash) {
            const newUpdates = { ...shaderPackUpdates };
            delete newUpdates[pack.sha1_hash];
            setShaderPackUpdates(newUpdates);
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

      fetchShaderPacks();
    } catch (err) {
      console.error("Failed to update all packs:", err);
      setShaderPacksError(
        `Failed to update all packs: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoadingOperation(false);
      setUpdatingPacks(new Set());
    }
  };

  const deletePack = async (packId: string) => {
    if (loadingOperation) return;

    const pack = shaderPacks.find((p) => p.filename === packId);
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

      setShaderPacks((packs) => packs.filter((p) => p.filename !== packId));
      setSelectedPacks((prev) => {
        const updated = new Set(prev);
        updated.delete(packId);
        return updated;
      });

      fetchShaderPacks();
    } catch (err) {
      console.error("Failed to delete pack:", err);
      setShaderPacksError(
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
      setShaderPacksError(
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
        const pack = shaderPacks.find((p) => p.filename === packId);
        if (!pack || !pack.path || !pack.is_disabled) return;

        return invoke("set_file_enabled", {
          filePath: pack.path,
          enabled: true,
        });
      });

      await Promise.all(promises);

      fetchShaderPacks();
    } catch (err) {
      console.error("Failed to enable selected packs:", err);
      setShaderPacksError(
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
        const pack = shaderPacks.find((p) => p.filename === packId);
        if (!pack || !pack.path || pack.is_disabled) return;

        return invoke("set_file_enabled", {
          filePath: pack.path,
          enabled: false,
        });
      });

      await Promise.all(promises);

      fetchShaderPacks();
    } catch (err) {
      console.error("Failed to disable selected packs:", err);
      setShaderPacksError(
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
        `Are you sure you want to delete ${selectedPacks.size} selected shader pack${
          selectedPacks.size !== 1 ? "s" : ""
        }? This cannot be undone.`,
      )
    ) {
      return;
    }

    setLoadingOperation(true);

    try {
      const promises = Array.from(selectedPacks).map(async (packId) => {
        const pack = shaderPacks.find((p) => p.filename === packId);
        if (!pack || !pack.path) return;

        return invoke("delete_file", {
          filePath: pack.path,
        });
      });

      await Promise.all(promises);

      setShaderPacks((packs) =>
        packs.filter((p) => !selectedPacks.has(p.filename)),
      );
      setSelectedPacks(new Set());

      fetchShaderPacks();
    } catch (err) {
      console.error("Failed to delete selected packs:", err);
      setShaderPacksError(
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

  const filteredPacks = shaderPacks.filter((pack) =>
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

  const packsWithUpdates = shaderPacks.filter((pack) =>
    hasShaderPackUpdate(pack),
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
              placeholder={t('shaderpacks.search_placeholder')}
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
              onClick={checkForShaderPackUpdates}
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
        {loadingShaderPacks ? (
          <LoadingState message={t('shaderpacks.loading')} />
        ) : shaderPacksError ? (
          <div className="p-4 text-red-400 bg-red-900/20 rounded border border-red-700/30">
            <div className="flex items-center gap-2">
              <Icon icon="solar:danger-bold" className="w-5 h-5" />
              <span>{shaderPacksError}</span>
            </div>
            <button
              className="mt-2 px-3 py-1 bg-red-800/30 hover:bg-red-800/50 border border-red-700/30 rounded text-sm transition-colors"
              onClick={fetchShaderPacks}
            >
              Try Again
            </button>
          </div>
        ) : (
          <ContentTable
            headers={[
              {
                key: "name",
                label: "shader pack name",
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
            totalCount={shaderPacks.length}
            filteredCount={filteredPacks.length}
            enabledCount={enabledPacks}
            onSelectAll={handleSelectAll}
            contentType="shader pack"
            searchQuery={effectiveSearchQuery}
          >
            {sortedPacks.length > 0 ? (
              sortedPacks.map((pack) => {
                const hasUpdate = hasShaderPackUpdate(pack);
                const updateVersion = hasUpdate
                  ? getShaderPackUpdateVersion(pack)
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
                    iconType="solar:sun-bold"
                    formatFileSize={formatFileSize}
                    onCheckForUpdates={checkForShaderPackUpdates}
                  ></ContentPackRow>
                );
              })
            ) : (
              <EmptyState
                icon="solar:sun-bold"
                message={
                  effectiveSearchQuery
                    ? "no shader packs match your search"
                    : "no shader packs installed"
                }
                description="Drag and drop shader pack files here to install"
              />
            )}
          </ContentTable>
        )}
      </div>
    </div>
  );
}
