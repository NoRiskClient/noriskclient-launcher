"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModRow } from "./ModRow";
import type { Mod, Profile } from "../../../types/profile";
import * as ProfileService from "../../../services/profile-service";
import { SearchInput } from "../../ui/SearchInput";
import { LoadingState } from "../../ui/LoadingState";
import { EmptyState } from "../../ui/EmptyState";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ModrinthBulkUpdateRequestBody,
  ModrinthHashAlgorithm,
  ModrinthVersion,
  ModrinthProject,
} from "../../../types/modrinth";
import { useThemeStore } from "../../../store/useThemeStore";
import { ContentTable } from "../../ui/ContentTable";
import { Button } from "../../ui/buttons/Button";
import { ErrorMessage } from "../../ui/ErrorMessage";
import { gsap } from "gsap";
import { ModrinthService } from "../../../services/modrinth-service";
import { AutoSizer } from "react-virtualized/dist/es/AutoSizer";
import { List } from "react-virtualized/dist/es/List";
import type { ListRowProps } from "react-virtualized";

interface ModsTabProps {
  profile: Profile;
  onRefresh?: () => void;
  isActive?: boolean;
  searchQuery?: string;
  onBrowse?: (contentType: string) => void;
}

interface ModSourceModrinth {
  type: "modrinth";
  project_id: string;
  version_id: string;
  file_name: string;
  file_hash_sha1?: string;
}

export function ModsTab({
  profile,
  onRefresh,
  isActive = false,
  searchQuery = "",
}: ModsTabProps) {
  const { t } = useTranslation();
  const [mods, setMods] = useState<Mod[]>(profile.mods || []);
  const [selectedMods, setSelectedMods] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "enabled" | "version">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [error, setError] = useState<string | null>(null);

  const [modUpdates, setModUpdates] = useState<
    Record<string, ModrinthVersion | null>
  >({});
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updatingMods, setUpdatingMods] = useState<Set<string>>(new Set());
  const accentColor = useThemeStore((state) => state.accentColor);
  const containerRef = useRef<HTMLDivElement>(null);
  const [modrinthIcons, setModrinthIcons] = useState<Record<string, string | null>>({});

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

  useEffect(() => {
    const fetchAllModrinthIcons = async () => {
      if (!mods || mods.length === 0) {
        setModrinthIcons({});
        return;
      }

      const modrinthProjectIds = mods
        .filter(
          (mod) => mod.source?.type === "modrinth" && mod.source.project_id,
        )
        .map((mod) => (mod.source as ModSourceModrinth).project_id!);

      if (modrinthProjectIds.length > 0) {
        try {
          const projectDetailsList = await ModrinthService.getProjectDetails(modrinthProjectIds);

          const icons: Record<string, string | null> = {};
          projectDetailsList.forEach((detail) => {
            if (detail?.id && detail.icon_url) {
              icons[detail.id] = detail.icon_url;
            }
          });
          setModrinthIcons(icons);
        } catch (err) {
          console.error("Failed to fetch Modrinth project details in bulk:", err);
          // Optionally set an error state or handle partial failures
        }
      } else {
        setModrinthIcons({});
      }
    };

    fetchAllModrinthIcons();
  }, [mods]); // Re-fetch if mods array changes

  const handleUpdateMod = async (mod: Mod, updateVersion: ModrinthVersion) => {
    if (
      mod.source?.type !== "modrinth" ||
      !(mod.source as ModSourceModrinth).file_hash_sha1
    ) {
      console.error("Cannot update non-Modrinth mod or mod without hash");
      return;
    }

    setUpdatingMods((prev) => new Set(prev).add(mod.id));

    try {
      const newUpdates = { ...modUpdates };
      delete newUpdates[(mod.source as ModSourceModrinth).file_hash_sha1!];
      setModUpdates(newUpdates);

      console.log(
        `Updating mod ${mod.display_name || mod.id} from ${mod.version} to ${updateVersion.version_number}`,
      );

      await invoke("update_modrinth_mod_version", {
        profileId: profile.id,
        modInstanceId: mod.id,
        newVersionDetails: updateVersion,
      });

      console.log(`Successfully updated mod ${mod.display_name || mod.id}`);

      setMods((currentMods) =>
        currentMods.map((m) =>
          m.id === mod.id
            ? {
                ...m,
                version: updateVersion.version_number,
                source:
                  m.source?.type === "modrinth"
                    ? {
                        ...m.source,
                        version_id: updateVersion.id,
                      }
                    : m.source,
              }
            : m,
        ),
      );

      await fetchMods();
    } catch (error) {
      console.error("Failed to update mod:", error);
      setError(
        `Failed to update mod: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setUpdatingMods((prev) => {
        const newSet = new Set(prev);
        newSet.delete(mod.id);
        return newSet;
      });
    }
  };

  const handleUpdateAllMods = async () => {
    const modsToUpdate = mods.filter((mod) => {
      if (
        mod.source?.type !== "modrinth" ||
        !(mod.source as ModSourceModrinth).file_hash_sha1
      ) {
        return false;
      }
      const hash = (mod.source as ModSourceModrinth).file_hash_sha1!;
      return hash in modUpdates;
    });

    if (modsToUpdate.length === 0) return;

    for (const mod of modsToUpdate) {
      const hash = (mod.source as ModSourceModrinth).file_hash_sha1!;
      const updateVersion = modUpdates[hash];
      if (updateVersion) {
        await handleUpdateMod(mod, updateVersion);
      }
    }
  };

  const fetchMods = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const updatedProfile = await ProfileService.getProfile(profile.id);
      setMods(updatedProfile.mods || []);
      if (onRefresh) onRefresh();
    } catch (error) {
      console.error("Failed to fetch mods:", error);
      setError(
        `Failed to load mods: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const checkForModUpdates = async (currentProfile = profile) => {
    if (!currentProfile.mods || currentProfile.mods.length === 0) return;

    const modsWithHashes = currentProfile.mods.filter(
      (mod: Mod) =>
        mod.source?.type === "modrinth" &&
        (mod.source as ModSourceModrinth).file_hash_sha1 != null,
    );

    if (modsWithHashes.length === 0) return;

    const hashes = modsWithHashes.map(
      (mod: Mod) => (mod.source as ModSourceModrinth).file_hash_sha1!,
    );

    setCheckingUpdates(true);
    setUpdateError(null);

    try {
      const request: ModrinthBulkUpdateRequestBody = {
        hashes,
        algorithm: "sha1" as ModrinthHashAlgorithm,
        loaders: [currentProfile.loader],
        game_versions: [currentProfile.game_version],
      };

      console.log(`Checking for updates for ${hashes.length} mods...`);

      const updates = await invoke<Record<string, ModrinthVersion>>(
        "check_modrinth_updates",
        { request },
      );

      setModUpdates({});

      const filteredUpdates: Record<string, ModrinthVersion> = {};

      const modsByHash = new Map<string, Mod>();
      for (const mod of modsWithHashes) {
        const hash = (mod.source as ModSourceModrinth).file_hash_sha1!;
        modsByHash.set(hash, mod);
      }

      for (const [hash, version] of Object.entries(updates)) {
        const mod = modsByHash.get(hash);
        if (mod && mod.version !== version.version_number) {
          filteredUpdates[hash] = version;
          console.log(
            `Update available for mod ${mod.display_name || mod.id}: Current: ${mod.version}, New: ${version.version_number}`,
          );
        } else if (mod) {
          console.log(
            `Mod ${mod.display_name || mod.id} is already at the latest version: ${mod.version}`,
          );
        }
      }
      if (Object.keys(filteredUpdates).length > 0) {
        setModUpdates(filteredUpdates);
        console.log(
          `Found updates for ${Object.keys(filteredUpdates).length} mods`,
        );
      } else {
        console.log("No updates available for any mods");
      }
    } catch (error) {
      console.error("Error checking for mod updates:", error);
      setUpdateError(
        error instanceof Error
          ? error.message
          : "Error checking for mod updates",
      );
    } finally {
      setCheckingUpdates(false);
    }
  };

  useEffect(() => {
    fetchMods();
  }, [profile.id]);

  const handleCheckUpdates = () => {
    checkForModUpdates({ ...profile, mods });
  };

  useEffect(() => {
    if (profile.mods && profile.mods.length > 0) {
      checkForModUpdates(profile);
    }
  }, []);

  const handleToggleMod = async (modId: string) => {
    try {
      const mod = mods.find((m) => m.id === modId);
      if (!mod) return;

      await ProfileService.setProfileModEnabled(
        profile.id,
        modId,
        !mod.enabled,
      );

      setMods(
        mods.map((m) => (m.id === modId ? { ...m, enabled: !m.enabled } : m)),
      );
    } catch (error) {
      console.error("Failed to toggle mod:", error);
      setError(
        `Failed to toggle mod: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const handleDeleteMod = async (modId: string) => {
    try {
      await ProfileService.deleteModFromProfile(profile.id, modId);

      setMods(mods.filter((m) => m.id !== modId));
      setSelectedMods((prev) => {
        const updated = new Set(prev);
        updated.delete(modId);
        return updated;
      });
    } catch (error) {
      console.error("Failed to delete mod:", error);
      setError(
        `Failed to delete mod: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const handleSelectMod = (modId: string) => {
    setSelectedMods((prev) => {
      const updated = new Set(prev);
      if (updated.has(modId)) {
        updated.delete(modId);
      } else {
        updated.add(modId);
      }
      return updated;
    });
  };

  const handleSelectAll = () => {
    if (selectedMods.size === filteredMods.length) {
      setSelectedMods(new Set());
    } else {
      setSelectedMods(new Set(filteredMods.map((mod) => mod.id)));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedMods.size === 0) return;

    if (
      !confirm(
        `Are you sure you want to delete ${selectedMods.size} selected mod${
          selectedMods.size !== 1 ? "s" : ""
        }? This cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      const promises = Array.from(selectedMods).map((modId) =>
        ProfileService.deleteModFromProfile(profile.id, modId),
      );
      await Promise.all(promises);

      setMods(mods.filter((m) => !selectedMods.has(m.id)));
      setSelectedMods(new Set());
    } catch (error) {
      console.error("Failed to delete selected mods:", error);
      setError(
        `Failed to delete selected mods: ${error instanceof Error ? error.message : String(error)}`,
      );
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

  const getModUpdateVersion = (mod: Mod): ModrinthVersion | null => {
    if (
      mod.source?.type !== "modrinth" ||
      !(mod.source as ModSourceModrinth).file_hash_sha1
    ) {
      return null;
    }

    const hash = (mod.source as ModSourceModrinth).file_hash_sha1!;
    return hash in modUpdates ? modUpdates[hash] : null;
  };

  const effectiveSearchQuery = searchQuery || localSearchQuery;

  const filteredMods = mods.filter((mod) => {
    const matchesSearch =
      mod.display_name
        ?.toLowerCase()
        .includes(effectiveSearchQuery.toLowerCase()) ||
      mod.id.toLowerCase().includes(effectiveSearchQuery.toLowerCase());

    return matchesSearch;
  });

  const sortedMods = [...filteredMods].sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "name":
        comparison = (a.display_name || "").localeCompare(b.display_name || "");
        break;
      case "enabled":
        comparison = Number(a.enabled) - Number(b.enabled);
        break;
      case "version":
        comparison = (a.version || "").localeCompare(b.version || "");
        break;
    }

    return sortDirection === "asc" ? comparison : -comparison;
  });

  const modsWithUpdates = mods.filter(
    (mod) =>
      mod.source?.type === "modrinth" &&
      (mod.source as ModSourceModrinth).file_hash_sha1 &&
      (mod.source as ModSourceModrinth).file_hash_sha1! in modUpdates,
  ).length;

  const rowRenderer = ({ index, key, style }: ListRowProps) => {
    const mod = sortedMods[index];
    return (
      <ModRow
        key={mod.id}
        style={style}
        mod={mod}
        isSelected={selectedMods.has(mod.id)}
        onSelect={() => handleSelectMod(mod.id)}
        onToggle={() => handleToggleMod(mod.id)}
        onDelete={() => handleDeleteMod(mod.id)}
        onUpdate={handleUpdateMod}
        updateVersion={getModUpdateVersion(mod)}
        checkingUpdates={checkingUpdates || updatingMods.has(mod.id)}
        modrinthIconUrl={mod.source?.type === "modrinth" && mod.source.project_id ? modrinthIcons[(mod.source as ModSourceModrinth).project_id!] : null}
      />
    );
  };

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
              placeholder={t('mods.search_placeholder')}
            />
          </div>
        )}

        <div className="flex items-center gap-4 ml-auto">
          <div className="flex items-center gap-2">
            {/* Update All button */}
            {modsWithUpdates > 0 && (
              <Button
                variant="success"
                size="sm"
                icon={
                  checkingUpdates ? (
                    <Icon icon="solar:refresh-bold" className="animate-spin" />
                  ) : (
                    <Icon icon="solar:arrow-up-bold" />
                  )
                }
                onClick={handleUpdateAllMods}
                disabled={checkingUpdates}
              >
                {t('shaderpacks.update_all')} ({modsWithUpdates})
              </Button>
            )}

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
              onClick={handleCheckUpdates}
              disabled={checkingUpdates}
            >
              {t('shaderpacks.check_updates')}
            </Button>

            {/* Delete button only shown when mods are selected */}
            {selectedMods.size > 0 && (
              <Button
                variant="destructive"
                size="sm"
                icon={<Icon icon="solar:trash-bin-trash-bold" />}
                onClick={handleDeleteSelected}
              >
                {t('common.delete')} ({selectedMods.size})
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
            {t('shaderpacks.error_checking_updates', { error: updateError })}
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
        {isLoading ? (
          <LoadingState message={t('mods.loading')} />
        ) : error ? (
          <ErrorMessage message={error} />
        ) : (
          <ContentTable
            headers={[
              {
                key: "name",
                label: t('content.header.name'),
                sortable: true,
                width: "flex-1",
                className: "px-3",
              },
              {
                key: "version",
                label: t('content.header.version'),
                sortable: true,
                width: "w-32",
              },
              {
                key: "enabled",
                label: t('content.header.status'),
                sortable: true,
                width: "w-16",
                className: "text-center",
              },
              {
                key: "actions",
                label: t('content.header.actions'),
                sortable: false,
                width: "w-24",
                className: "text-center",
              },
            ]}
            sortKey={sortBy}
            sortDirection={sortDirection}
            onSort={handleSort}
            selectedCount={selectedMods.size}
            totalCount={mods.length}
            filteredCount={filteredMods.length}
            enabledCount={filteredMods.filter((m) => m.enabled).length}
            onSelectAll={handleSelectAll}
            contentType="mod"
            searchQuery={effectiveSearchQuery}
          >
            {sortedMods.length > 0 ? (
              // @ts-ignore TODO: Resolve react-virtualized type issue with React 18
              <AutoSizer>
                {({ height, width }) => (
                  // @ts-ignore TODO: Resolve react-virtualized type issue with React 18
                  <List
                    width={width}
                    height={height}
                    rowCount={sortedMods.length}
                    rowHeight={90}
                    rowRenderer={rowRenderer}
                    overscanRowCount={10}
                  />
                )}
              </AutoSizer>
            ) : (
              <EmptyState
                icon="solar:widget-bold"
                message={
                  effectiveSearchQuery
                    ? "no mods match your search"
                    : "no mods installed"
                }
                description="Drag and drop mod files here to install"
              />
            )}
          </ContentTable>
        )}
      </div>
    </div>
  );
}
