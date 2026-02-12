"use client";

import { Icon } from "@iconify/react";
import { Button } from "../../../ui/buttons/Button";
import { IconButton } from "../../../ui/buttons/IconButton";
// import { GenericListItem } from "../../../ui/GenericListItem"; // Likely remove or adapt
import { TagBadge } from "../../../ui/TagBadge";
import { useThemeStore } from "../../../../store/useThemeStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GenericContentTab } from "../../../ui/GenericContentTab";
import { preloadIcons } from "../../../../lib/icon-utils";
import type { Profile } from "../../../../types/profile"; // Import real types
import type {
  NoriskModEntryDefinition,
  NoriskModpacksConfig,
  NoriskModSourceDefinition,
} from "../../../../types/noriskPacks"; // Changed NoriskPackMod to NoriskModEntryDefinition
import * as ProfileService from "../../../../services/profile-service"; // Import ProfileService
// import { ModrinthService } from "../../../../services/modrinth-service"; // No Modrinth specific service needed for NoRisk
import { SearchInput } from "../../../ui/SearchInput";
import { Checkbox } from "../../../ui/Checkbox";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event"; // For state updates
import { GenericDetailListItem } from "../items/GenericDetailListItem";
import { toast } from "react-hot-toast";
// import { toggleContentFromProfile } from "../../../../services/content-service"; // NoRisk has its own toggle
// import type { ToggleContentPayload } from "../../../../types/content"; // Not directly needed
import { Select, type SelectOption } from "../../../ui/Select"; // Import Select and SelectOption
import { useTranslation } from "react-i18next";

// Icons specific to NoRiskModsTabV2 (can be adjusted)
const NORISK_MODS_TAB_ICONS_TO_PRELOAD = [
  "solar:shield-bold-duotone", // Fallback icon, empty state, NoRisk theme
  "solar:settings-bold-duotone",
  "solar:info-circle-bold-duotone",
  "solar:check-circle-bold", // Enabled status
  "solar:close-circle-bold", // Disabled status
  "solar:box-bold-duotone", // Generic mod icon (if no specific NoRisk icon)
  "solar:folder-open-bold-duotone",
  "solar:trash-bin-trash-bold", // Might not be used if NoRisk mods are not deletable
  "solar:menu-dots-bold",
  "solar:sort-from_top_to_bottom-bold-duotone",
  "solar:refresh-square-bold-duotone",
  // "solar:cloud-download-bold-duotone", // NoRisk mods are not individually downloaded/updated this way
  "solar:refresh-bold", // For Refreshing NoRisk Pack list
  "solar:add-circle-bold-duotone", // Might not be used if mods are only from pack
  "solar:refresh-outline",
  // "solar:double-alt-arrow-up-bold-duotone" // No "Update All" for NoRisk mods
  "solar:danger-triangle-bold", // For errors
];

// Adapted from NoRiskModsTab.tsx
interface NoRiskModV2 {
  id: string; // Typically the mod's unique identifier within the pack
  display_name: string;
  description?: string;
  version?: string;
  enabled: boolean;
  source_type?: NoriskModSourceDefinition["type"]; // Added to store source type for badges
  // path?: string; // Path might not be relevant if icons are fetched by ID/name
  // We will store fetched local icons in a separate state similar to ModsTabV2/ResourcePacksTabV2
}

interface NoRiskModsTabV2Props {
  profile: Profile; // Profile is required
  onRefreshRequired?: () => void;
}

// Helper (can be adapted or removed if not needed)
// const getModFileNameFromSource = (mod: NoRiskModV2 | null | undefined): string | null => { ... }

export function NoRiskModsTabV2({
  profile,
  onRefreshRequired,
}: NoRiskModsTabV2Props) {
  const { t } = useTranslation();

  if (!profile) {
    // This should ideally not happen if Profile is marked as required
    // but as a safeguard:
    return (
      <div className="p-4 font-minecraft text-center text-white/70">
        {t('content.norisk.profile_unavailable')}
      </div>
    );
  }

  const accentColor = useThemeStore((state) => state.accentColor);

  const [noriskMods, setNoriskMods] = useState<NoRiskModV2[]>([]);
  const [noriskPacksConfig, setNoriskPacksConfig] =
    useState<NoriskModpacksConfig | null>(null);
  const [localIcons, setLocalIcons] = useState<Record<string, string | null>>(
    {},
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingPacks, setIsRefreshingPacks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [modBeingToggled, setModBeingToggled] = useState<string | null>(null);
  const [selectedModIds, setSelectedModIds] = useState<Set<string>>(new Set());
  const [isBatchToggling, setIsBatchToggling] = useState(false);
  const [unlistenFn, setUnlistenFn] = useState<(() => void) | undefined>();

  // Ref to track the last pack ID for which mods were loaded/attempted to load
  const lastLoadedPackIdRef = useRef<string | null | undefined>(
    profile.selected_norisk_pack_id,
  );

  // Moved data fetching and processing logic before useEffects that depend on them
  const isNoriskModDisabled = useCallback(
    (packModId: string): boolean => {
      if (
        !profile.selected_norisk_pack_id ||
        !profile.disabled_norisk_mods_detailed
      ) {
        return false;
      }
      return profile.disabled_norisk_mods_detailed.some(
        (identifier) =>
          identifier.pack_id === profile.selected_norisk_pack_id &&
          identifier.mod_id === packModId &&
          identifier.game_version === profile.game_version &&
          identifier.loader === profile.loader,
      );
    },
    [
      profile.selected_norisk_pack_id,
      profile.disabled_norisk_mods_detailed,
      profile.game_version,
      profile.loader,
    ],
  );

  const fetchModIconsForNoRisk = useCallback(
    async (compatibleRawMods: NoriskModEntryDefinition[]) => {
      if (compatibleRawMods.length === 0) {
        setLocalIcons({});
        return;
      }
      try {
        const iconsResult = await invoke<Record<string, string | null>>(
          "get_icons_for_norisk_mods",
          {
            mods: compatibleRawMods,
            minecraftVersion: profile.game_version,
            loader: profile.loader,
          },
        );
        if (iconsResult) {
          setLocalIcons(iconsResult);
        } else {
          setLocalIcons({});
        }
      } catch (err) {
        console.error("Failed to fetch NoRisk mod icons:", err);
        setLocalIcons({});
      }
    },
    [profile.game_version, profile.loader],
  );

  const processFetchedMods = useCallback(
    async (
      rawMods: NoriskModEntryDefinition[],
      currentPacksConfig: NoriskModpacksConfig,
    ) => {
      let compatibleRawMods = rawMods;
      if (rawMods.length > 0 && rawMods[0].compatibility) {
        compatibleRawMods = rawMods.filter((mod) => {
          if (!mod.compatibility) return true;
          const gameVersionCompat = mod.compatibility[profile.game_version];
          if (!gameVersionCompat) return false;
          return !!gameVersionCompat[profile.loader];
        });
      }

      const processedMods: NoRiskModV2[] = compatibleRawMods.map((rawMod) => {
        let version: string | undefined = undefined;
        if (
          rawMod.compatibility &&
          rawMod.compatibility[profile.game_version] &&
          rawMod.compatibility[profile.game_version][profile.loader]
        ) {
          const target =
            rawMod.compatibility[profile.game_version][profile.loader];
          if (target) {
            version = target.identifier;
          }
        }
        const enabled = !isNoriskModDisabled(rawMod.id);
        return {
          id: rawMod.id,
          display_name: rawMod.displayName || rawMod.id,
          version: version,
          enabled: enabled,
          source_type: rawMod.source?.type,
        };
      });

      setNoriskMods(processedMods);

      if (compatibleRawMods.length > 0) {
        await fetchModIconsForNoRisk(compatibleRawMods);
      } else {
        setLocalIcons({});
      }
    },
    [
      isNoriskModDisabled,
      profile.game_version,
      profile.loader,
      fetchModIconsForNoRisk,
    ],
  );

  const fetchNoriskPacksAndMods = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      let currentPacksConfig = noriskPacksConfig;
      if (!currentPacksConfig) {
        try {
          currentPacksConfig = await ProfileService.getNoriskPacksResolved();
        } catch (resolvedError) {
          console.warn(
            "Failed to get resolved NoRisk packs, trying basic:",
            resolvedError,
          );
          currentPacksConfig = await ProfileService.getNoriskPacks();
        }
        setNoriskPacksConfig(currentPacksConfig);
      }

      if (profile.selected_norisk_pack_id && currentPacksConfig) {
        let rawModsData: NoriskModEntryDefinition[] = [];
        try {
          const modsResult = await invoke<NoriskModEntryDefinition[]>(
            "get_norisk_pack_mods",
            {
              packId: profile.selected_norisk_pack_id,
              gameVersion: profile.game_version,
              loader: profile.loader,
            },
          );
          if (Array.isArray(modsResult)) {
            rawModsData = modsResult;
          } else {
            console.warn(
              "Unexpected response from get_norisk_pack_mods, not an array:",
              modsResult,
            );
            const packDef =
              currentPacksConfig.packs[profile.selected_norisk_pack_id];
            if (packDef?.mods) {
              rawModsData = packDef.mods;
            }
          }
        } catch (directError) {
          console.warn(
            "get_norisk_pack_mods failed, trying fallback to pack definition:",
            directError,
          );
          const packDef =
            currentPacksConfig.packs[profile.selected_norisk_pack_id];
          if (packDef?.mods) {
            rawModsData = packDef.mods;
          } else {
            console.warn(
              "Pack definition has no mods, trying list_norisk_mods for profile:",
              profile.id,
            );
            try {
              const lastResortResult = await invoke<NoriskModEntryDefinition[]>(
                "list_norisk_mods",
                {
                  profileId: profile.id,
                },
              );
              if (Array.isArray(lastResortResult)) {
                rawModsData = lastResortResult;
              } else {
                console.error(
                  "list_norisk_mods also returned unexpected data:",
                  lastResortResult,
                );
              }
            } catch (lastResortError) {
              console.error("list_norisk_mods also failed:", lastResortError);
              throw new Error(
                `Failed to load NoRisk mods. Pack: ${profile.selected_norisk_pack_id}. Error: ${lastResortError}`,
              );
            }
          }
        }

        if (rawModsData.length > 0) {
          await processFetchedMods(rawModsData, currentPacksConfig);
        } else {
          setNoriskMods([]);
          setLocalIcons({});
          console.log(
            "No NoRisk mods found for pack:",
            profile.selected_norisk_pack_id,
          );
        }
      } else {
        setNoriskMods([]);
        setLocalIcons({});
      }
    } catch (err) {
      console.error("Failed to load NoRisk packs or mods:", err);
      setError(
        `Failed to load NoRisk data: ${err instanceof Error ? err.message : String(err)}`,
      );
      setNoriskMods([]);
      setLocalIcons({});
    } finally {
      setIsLoading(false);
    }
  }, [
    profile.id,
    profile.selected_norisk_pack_id,
    profile.game_version,
    profile.loader,
    noriskPacksConfig,
    processFetchedMods,
  ]);

  useEffect(() => {
    preloadIcons(NORISK_MODS_TAB_ICONS_TO_PRELOAD);
  }, []);

  // Effect to listen for global state events that might require a refresh
  useEffect(() => {
    const setupEventListeners = async () => {
      const unlisten = await listen<any>("state_event", (event) => {
        const payload = event.payload;
        if (
          payload.event_type === "trigger_profile_update" &&
          payload.target_id === profile.id
        ) {
          fetchNoriskPacksAndMods();
        }
      });
      setUnlistenFn(() => unlisten);
      return unlisten;
    };

    setupEventListeners();

    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [profile.id, unlistenFn, fetchNoriskPacksAndMods]);

  // Initial data load and load when profile or selected pack changes
  useEffect(() => {
    if (lastLoadedPackIdRef.current !== profile.selected_norisk_pack_id) {
      setNoriskMods([]);
      setLocalIcons({});
    }
    fetchNoriskPacksAndMods();
    lastLoadedPackIdRef.current = profile.selected_norisk_pack_id;
  }, [profile.id, profile.selected_norisk_pack_id, fetchNoriskPacksAndMods]);

  const handleRefreshPacks = async () => {
    setIsRefreshingPacks(true);
    setError(null);
    try {
      await ProfileService.refreshNoriskPacks(); // This should internally trigger updates or we refetch
      // After refreshing, refetch everything
      // By setting noriskPacksConfig to null, we ensure it's re-fetched by fetchNoriskPacksAndMods
      setNoriskPacksConfig(null);
      // fetchNoriskPacksAndMods will be called by the useEffect due to noriskPacksConfig change
      // or we can call it directly if preferred, but resetting config should be enough
      // For explicit control:
      await fetchNoriskPacksAndMods();
    } catch (err) {
      console.error("Failed to refresh NoRisk packs list:", err);
      setError(
        `Failed to refresh NoRisk packs: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsRefreshingPacks(false);
    }
  };

  const handleToggleNoRiskMod = useCallback(
    async (modId: string) => {
      if (!profile.selected_norisk_pack_id) {
        toast.error(t('content.norisk.toast.no_pack_selected'));
        return;
      }
      const mod = noriskMods.find((m) => m.id === modId);
      if (!mod) {
        toast.error(t('content.norisk.toast.mod_not_found'));
        return;
      }

      setModBeingToggled(modId);
      const newEnabledState = !mod.enabled;

      setNoriskMods((prevMods) =>
        prevMods.map((m) =>
          m.id === modId ? { ...m, enabled: newEnabledState } : m,
        ),
      );

      try {
        await invoke("set_norisk_mod_status", {
          profileId: profile.id,
          packId: profile.selected_norisk_pack_id,
          modId: modId,
          gameVersion: profile.game_version,
          loaderStr: profile.loader,
          disabled: !newEnabledState,
        });

        // SUCCESS: Backend updated. Optimistic UI update is already done.
        // No onRefreshRequired() needed here if optimistic update is sufficient for UI.
        // The actual profile.disabled_norisk_mods_detailed will be updated on next full refresh/load.
      } catch (err) {
        console.error(`Failed to toggle NoRisk mod ${mod.display_name}:`, err);
        toast.error(
          t('content.norisk.toast.toggle_failed', { name: mod.display_name, error: err instanceof Error ? err.message : String(err) }),
        );
        setNoriskMods((prevMods) =>
          prevMods.map((m) =>
            m.id === modId ? { ...m, enabled: mod.enabled } : m,
          ),
        );
      } finally {
        setModBeingToggled(null);
      }
    },
    [noriskMods, profile, onRefreshRequired, t],
  ); // Keep onRefreshRequired in deps if other parts of the callback chain might still need it, though we are not calling it.
  // Or remove if truly not needed by any path from this callback.
  // For now, let's assume it might be used by error paths or future extensions, so keep it.

  const filteredMods = useMemo(() => {
    let modsToFilter = noriskMods;
    if (searchQuery) {
      modsToFilter = noriskMods.filter(
        (mod) =>
          (mod.display_name || mod.id)
            .toLowerCase()
            .includes(searchQuery.toLowerCase()) ||
          (mod.description || "")
            .toLowerCase()
            .includes(searchQuery.toLowerCase()),
      );
    }
    return [...modsToFilter].sort((a, b) => {
      const nameA = a.display_name || a.id;
      const nameB = b.display_name || b.id;
      return nameA.localeCompare(nameB);
    });
  }, [noriskMods, searchQuery]);

  // Define handleModSelectionChange first as renderNoRiskModItem depends on it.
  const handleModSelectionChange = useCallback(
    (modId: string, isSelected: boolean) => {
      setSelectedModIds((prevSelectedIds) => {
        const newSelectedIds = new Set(prevSelectedIds);
        if (isSelected) {
          newSelectedIds.add(modId);
        } else {
          newSelectedIds.delete(modId);
        }
        return newSelectedIds;
      });
    },
    [],
  );

  const areAllFilteredSelected = useMemo(() => {
    if (filteredMods.length === 0) return false;
    return filteredMods.every((mod) => selectedModIds.has(mod.id));
  }, [filteredMods, selectedModIds]);

  const handleSelectAllToggle = useCallback(
    (isChecked: boolean) => {
      if (isChecked) {
        setSelectedModIds(new Set(filteredMods.map((mod) => mod.id)));
      } else {
        setSelectedModIds(new Set());
      }
    },
    [filteredMods],
  );

  const handleBatchToggleSelected = async () => {
    if (!profile.selected_norisk_pack_id || selectedModIds.size === 0) {
      if (selectedModIds.size > 0) toast.error(t('content.norisk.toast.no_pack_selected'));
      return;
    }

    setIsBatchToggling(true);
    const errors: string[] = [];
    let successfulToggles = 0;

    const modsToToggle = Array.from(selectedModIds)
      .map((id) => noriskMods.find((m) => m.id === id))
      .filter(Boolean) as NoRiskModV2[];

    for (const mod of modsToToggle) {
      const currentModState = noriskMods.find((m) => m.id === mod.id);
      if (!currentModState) {
        errors.push(t('content.norisk.toast.mod_not_found_batch', { id: mod.id }));
        continue;
      }
      const newEnabledState = !currentModState.enabled;

      try {
        await invoke("set_norisk_mod_status", {
          profileId: profile.id,
          packId: profile.selected_norisk_pack_id,
          modId: mod.id,
          gameVersion: profile.game_version,
          loaderStr: profile.loader,
          disabled: !newEnabledState,
        });
        successfulToggles++;
        setNoriskMods((prev) =>
          prev.map((m) =>
            m.id === mod.id ? { ...m, enabled: newEnabledState } : m,
          ),
        );
      } catch (err) {
        const errorDetail = err instanceof Error ? err.message : String(err);
        errors.push(t('content.norisk.toast.toggle_failed', { name: mod.display_name, error: errorDetail }));
        toast.error(t('content.norisk.toast.toggle_failed', { name: mod.display_name, error: errorDetail }));
        // No individual revert here; the full list isn't reverted on partial batch failure.
        // The items that failed will remain in their original state in the UI due to lack of optimistic update for them.
      }
    }

    setIsBatchToggling(false);
    setSelectedModIds(new Set());

    if (errors.length > 0) {
      console.warn(
        "Batch NoRisk mod toggle finished with errors:",
        errors.join("; "),
      );
    }
  };

  const handleSelectedPackChange = async (newPackId: string | null) => {
    // Allow null for unsetting
    if (newPackId === profile.selected_norisk_pack_id) return; // No change
    try {
      await ProfileService.updateProfile(profile.id, {
        selected_norisk_pack_id: newPackId,
        clear_selected_norisk_pack: newPackId === null,
      });
      if (onRefreshRequired) {
        onRefreshRequired();
      }
    } catch (err) {
      console.error("Failed to update selected NoRisk pack:", err);
      toast.error(
        t('content.norisk.toast.switch_pack_failed', { error: err instanceof Error ? err.message : String(err) }),
      );
    }
  };

  const noriskPackOptions = useMemo((): SelectOption[] => {
    if (!noriskPacksConfig)
      return [{ value: "", label: t('content.no_pack_selected') }]; // Return default if no config

    const options = Object.entries(noriskPacksConfig.packs).map(
      ([id, packDef]) => ({
        value: id,
        label: packDef.displayName || id,
      }),
    );

    // Sort packs by name
    options.sort((a, b) => a.label.localeCompare(b.label));

    // Prepend the "No Pack Selected" option
    return [{ value: "", label: t('content.no_pack_selected') }, ...options];
  }, [noriskPacksConfig, t]);

  const renderNoRiskModItem = useCallback(
    (mod: NoRiskModV2) => {
      const itemTitle = mod.display_name || mod.id;
      const isToggling = modBeingToggled === mod.id;

      let iconToShow: React.ReactNode;
      const localIconData = localIcons[mod.id];
      if (localIconData) {
        iconToShow = (
          <img
            src={`data:image/png;base64,${localIconData}`}
            alt={`${itemTitle} icon`}
            className="w-full h-full object-contain image-pixelated"
          />
        );
      } else {
        iconToShow = (
          <Icon
            icon={NORISK_MODS_TAB_ICONS_TO_PRELOAD[0]}
            className="w-8 h-8 sm:w-10 sm:h-10 text-white/40"
          />
        );
      }
      const itemIconNode = (
        <div className="absolute inset-0 w-full h-full flex items-center justify-center">
          {iconToShow}
        </div>
      );
      const itemDescriptionNode = (
        <span title={`${t('content.version_label')} ${mod.version || t('common.not_available')}`}>
          {t('content.version_label')} {mod.version || t('common.not_available')}
        </span>
      );
      const sourceTypeDisplay: Record<
        Extract<
          NoriskModSourceDefinition["type"],
          "modrinth" | "maven" | "url"
        >,
        { label: string; variant: "info" | "default" | "warning" }
      > = {
        modrinth: { label: t('content.platforms.modrinth'), variant: "info" },
        maven: { label: t('content.platforms.maven'), variant: "default" },
        url: { label: t('content.platforms.url'), variant: "warning" },
      };
      const itemBadgesNode = (
        <>
          <TagBadge
            size="sm"
            variant={mod.enabled ? "success" : "destructive"}
            iconElement={
              mod.enabled ? (
                <Icon icon={NORISK_MODS_TAB_ICONS_TO_PRELOAD[3]} />
              ) : (
                <Icon icon={NORISK_MODS_TAB_ICONS_TO_PRELOAD[4]} />
              )
            }
          >
            {mod.enabled ? t('common.enabled') : t('common.disabled')}
          </TagBadge>
          {mod.source_type &&
            sourceTypeDisplay[
              mod.source_type as Extract<
                NoriskModSourceDefinition["type"],
                "modrinth" | "maven" | "url"
              >
            ] && (
              <TagBadge
                size="sm"
                variant={
                  sourceTypeDisplay[
                    mod.source_type as Extract<
                      NoriskModSourceDefinition["type"],
                      "modrinth" | "maven" | "url"
                    >
                  ].variant
                }
                className="ml-1 capitalize"
              >
                {
                  sourceTypeDisplay[
                    mod.source_type as Extract<
                      NoriskModSourceDefinition["type"],
                      "modrinth" | "maven" | "url"
                    >
                  ].label
                }
              </TagBadge>
            )}
        </>
      );
      const itemMainActionNode = (
        <Button
          size="sm"
          variant={mod.enabled ? "secondary" : "default"}
          onClick={() => handleToggleNoRiskMod(mod.id)}
          disabled={isToggling || isBatchToggling}
        >
          {isToggling ? "..." : mod.enabled ? t('common.disable') : t('common.enable')}
        </Button>
      );

      return (
        <GenericDetailListItem
          id={mod.id}
          isSelected={selectedModIds.has(mod.id)}
          onSelectionChange={(checked) =>
            handleModSelectionChange(mod.id, checked)
          }
          iconNode={itemIconNode}
          title={itemTitle}
          descriptionNode={itemDescriptionNode}
          mainActionNode={itemMainActionNode}
          accentColor={accentColor.value}
        />
      );
    },
    [
      accentColor.value,
      handleToggleNoRiskMod,
      localIcons,
      modBeingToggled,
      isBatchToggling,
      NORISK_MODS_TAB_ICONS_TO_PRELOAD,
      selectedModIds,
      handleModSelectionChange, // Now correctly defined before this usage
      t,
    ],
  );

  const primaryLeftActionsContent = (
    <div className="flex flex-col gap-2 flex-grow min-w-0">
      <div className="flex items-center gap-2">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder={t('content.norisk.search_placeholder')}
          className="flex-grow !h-9"
          disabled={
            isLoading ||
            isRefreshingPacks ||
            isBatchToggling ||
            !profile.selected_norisk_pack_id
          }
        />
        <IconButton
          icon={
            isRefreshingPacks ? (
              <Icon icon="solar:refresh-bold" className="animate-spin" />
            ) : (
              <Icon icon="solar:refresh-outline" />
            )
          }
          onClick={handleRefreshPacks}
          disabled={
            isLoading ||
            isRefreshingPacks ||
            isBatchToggling ||
            !profile.selected_norisk_pack_id
          }
          variant="secondary"
          size="sm"
          title={
            isRefreshingPacks ? t('common.refreshing') : t('content.norisk.refresh_packs')
          }
          className="!h-9 !w-9 flex-shrink-0"
        />
      </div>

      <div
        className="h-px w-full my-1"
        style={{ backgroundColor: `${accentColor.value}30` }}
      />

      <div className="flex items-center justify-between w-full min-h-14">
        <Checkbox
          customSize="md"
          checked={areAllFilteredSelected}
          onChange={(e) => handleSelectAllToggle(e.target.checked)}
          disabled={filteredMods.length === 0 || isBatchToggling || isLoading}
          label={
            selectedModIds.size > 0
              ? `${selectedModIds.size} ${t('common.selected')}`
              : t('common.select_all')
          }
          title={
            areAllFilteredSelected
              ? t('common.deselect_all_visible')
              : t('common.select_all_visible')
          }
        />
        <div className="flex items-center gap-2">
          {selectedModIds.size > 0 && !!profile.selected_norisk_pack_id && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleBatchToggleSelected}
              disabled={isBatchToggling || isLoading || isRefreshingPacks}
              icon={
                isBatchToggling ? (
                  <Icon
                    icon="solar:refresh-bold"
                    className="animate-spin mr-1.5"
                  />
                ) : undefined
              }
            >
              {isBatchToggling
                ? t('content.actions.toggling')
                : `${t('content.actions.toggle_selected')} (${selectedModIds.size})`}
            </Button>
          )}
          {noriskPacksConfig && noriskPackOptions.length > 0 && (
            <div className="flex flex-col items-end">
              <Select
                value={profile.selected_norisk_pack_id || ""}
                onChange={(value) =>
                  handleSelectedPackChange(value === "" ? null : value)
                }
                options={noriskPackOptions}
                placeholder={t('content.norisk.select_pack')}
                className="!h-9 text-sm min-w-[180px]"
                size="sm"
                disabled={isLoading || isRefreshingPacks || isBatchToggling}
              />
              {profile.selected_norisk_pack_id &&
                noriskPacksConfig?.packs[profile.selected_norisk_pack_id]
                  ?.isExperimental && (
                  <div className="text-xs text-yellow-500/80 font-minecraft mt-0.5 text-right">
                    {t('content.experimental_pack')}
                  </div>
                )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <GenericContentTab<NoRiskModV2>
        items={profile.selected_norisk_pack_id ? filteredMods : []}
        renderListItem={renderNoRiskModItem}
        isLoading={isLoading && !!profile.selected_norisk_pack_id}
        error={error}
        searchQuery={searchQuery}
        primaryLeftActions={primaryLeftActionsContent}
        emptyStateIcon={NORISK_MODS_TAB_ICONS_TO_PRELOAD[0]}
        emptyStateMessage={
          !profile.selected_norisk_pack_id
            ? t('content.norisk.no_pack_selected_title')
            : error
              ? t('content.norisk.error_loading')
              : isLoading &&
                  filteredMods.length === 0 &&
                  !!profile.selected_norisk_pack_id
                ? t('content.norisk.loading')
                : !searchQuery &&
                    filteredMods.length === 0 &&
                    !!profile.selected_norisk_pack_id
                  ? t('content.norisk.empty_pack')
                  : searchQuery &&
                      filteredMods.length === 0 &&
                      !!profile.selected_norisk_pack_id
                    ? t('content.norisk.no_search_results')
                    : t('content.norisk.manage_title')
        }
        emptyStateDescription={
          !profile.selected_norisk_pack_id
            ? t('content.norisk.no_pack_selected_desc')
            : error
              ? t('content.norisk.error_desc')
              : isLoading &&
                  filteredMods.length === 0 &&
                  !!profile.selected_norisk_pack_id
                ? t('content.norisk.loading_desc')
                : !searchQuery &&
                    filteredMods.length === 0 &&
                    !!profile.selected_norisk_pack_id
                  ? t('content.norisk.empty_pack_desc')
                  : searchQuery &&
                      filteredMods.length === 0 &&
                      !!profile.selected_norisk_pack_id
                    ? t('content.norisk.no_search_results_desc')
                    : t('content.norisk.manage_desc')
        }
        loadingItemCount={
          isLoading &&
          !!profile.selected_norisk_pack_id &&
          noriskMods.length === 0
            ? 5
            : 0
        }
        showSkeletons={false}
        accentColorOverride={accentColor.value}
      />
    </>
  );
}
