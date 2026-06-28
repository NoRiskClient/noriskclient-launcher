"use client";

/**
 * LocalContentTabV3 — Konzept-stilisierter Content-Tab fuer Mods, ResourcePacks,
 * Shaders, DataPacks, NoRisk. Wiederverwendet useLocalContentManager (identische
 * Datenlogik wie V2), rendert aber im V3-Konzept-Look:
 *
 *  - Sticky Toolbar: Search + Filter + Sort + Refresh + Add-CTA
 *  - Grid aus Mod-Tiles mit Icon, Name, Version, Toggle, Hover-Menu
 *
 * Bewusst vereinfacht ggn. V2: keine Batch-Selection, keine Update-Check-Bar,
 * kein NoRisk-Pack-Selector. Komplexere Operationen bleiben im V2-Tab
 * verfuegbar (Toggle `USE_V3 = false`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "react-hot-toast";
import type { Profile } from "../../../../types/profile";
import { ModPlatform, type UnifiedVersion } from "../../../../types/unified";
import {
  type LocalContentItem,
  type LocalContentType,
  useLocalContentManager,
} from "../../../../hooks/useLocalContentManager";
import { getUpdateIdentifier } from "../../../../utils/update-identifier-utils";
import * as FlagsmithService from "../../../../services/flagsmith-service";
import UnifiedService from "../../../../services/unified-service";
import { useThemeStore } from "../../../../store/useThemeStore";
import { useAppDragDropStore } from "../../../../store/appStore";
import { ContentType as BackendContentType } from "../../../../types/content";
import { Tooltip } from "../../../ui/Tooltip";
import { ModUpdateText } from "../../../ui/ModUpdateText";
import { ConfirmDeleteDialog } from "../../../modals/ConfirmDeleteDialog";
import { BrowseContentSideSheetV3 } from "../BrowseContentSideSheetV3";
import { preloadIcons } from "../../../../lib/icon-utils";
import { useDelayedTrue } from "../../../../hooks/useDelayedTrue";
import { EmptyStateV3 } from "../shared/EmptyStateV3";
import { FloatingActionBar, type FABActionConfig } from "../shared/FloatingActionBar";
import { SearchWithFilters } from "../../../ui/SearchWithFilters";
import { ContentActionButtons, type ContentActionButton } from "../../../ui/ContentActionButtons";
import type { DropdownOption } from "../../../ui/CustomDropdown";
import { ContentTile } from "./local-content/ContentTile";
import { NoriskPackSelector } from "./local-content/NoriskPackSelector";

// Pre-load der haeufig genutzten Iconify-Icons fuer schnelleres First-Paint
preloadIcons([
  "solar:magnifer-linear", "solar:filter-bold", "solar:sort-vertical-bold",
  "solar:alt-arrow-down-linear", "solar:refresh-bold", "solar:refresh-circle-bold",
  "solar:add-circle-bold", "solar:shield-check-bold", "solar:close-circle-linear",
  "solar:bolt-bold-duotone", "solar:menu-dots-bold", "solar:folder-linear",
  "solar:trash-bin-trash-linear", "solar:trash-bin-trash-bold", "solar:tag-linear",
  "solar:check-circle-bold", "solar:check-read-linear", "solar:arrow-up-bold",
  "solar:play-bold", "solar:pause-bold", "solar:volume-cross-bold",
  "solar:volume-cross-linear", "solar:volume-loud-linear", "solar:volume-loud-bold",
  "solar:box-bold", "solar:danger-triangle-bold", "solar:close-circle-bold",
  // Sort/Filter icons
  "solar:sort-from-top-to-bottom-bold", "solar:ruler-bold", "solar:list-bold",
  "solar:hand-stars-bold",
]);

type SortKey = "name" | "size" | "type" | "updates";
type FilterKey =
  | "all" | "enabled" | "disabled"
  | "hasUpdate" | "fromModpack" | "manuallyAdded" | "updatesPaused" | "noriskIssues";

interface LocalContentTabV3Props<T extends LocalContentItem> {
  profile: Profile;
  contentType: LocalContentType;
  getDisplayFileName: (item: T) => string;
  itemTypeName: string;
  itemTypeNamePlural: string;
  addContentButtonText: string;
  emptyStateIconOverride?: string;
  onRefreshRequired?: () => void;
}

const SORT_OPTIONS: { value: SortKey; labelKey: string; icon: string }[] = [
  { value: "name",    labelKey: "profiles.v3.sort.name",          icon: "solar:sort-from-top-to-bottom-bold" },
  { value: "updates", labelKey: "profiles.v3.sort.updatesFirst",  icon: "solar:arrow-up-bold" },
  { value: "size",    labelKey: "profiles.v3.sort.size",          icon: "solar:ruler-bold" },
  { value: "type",    labelKey: "profiles.v3.sort.source",        icon: "solar:box-bold" },
];

interface FilterOption {
  value: FilterKey;
  labelKey: string;
  icon: string;
  /** Gruppen-Trennlinie VOR diesem Item einfuegen. */
  separator?: boolean;
  /** Wenn true, nur zeigen wenn NRC-Pack aktiv. */
  nrcOnly?: boolean;
}

const FILTER_OPTIONS: FilterOption[] = [
  { value: "all",           labelKey: "profiles.v3.filter.all",            icon: "solar:list-bold" },
  { value: "enabled",       labelKey: "profiles.v3.filter.enabled",        icon: "solar:check-circle-bold" },
  { value: "disabled",      labelKey: "profiles.v3.filter.disabled",       icon: "solar:close-circle-bold" },
  { value: "hasUpdate",     labelKey: "profiles.v3.filter.hasUpdate",      icon: "solar:arrow-up-bold",        separator: true },
  { value: "updatesPaused", labelKey: "profiles.v3.filter.updatesPaused",  icon: "solar:volume-cross-bold" },
  { value: "fromModpack",   labelKey: "profiles.v3.filter.fromModpack",    icon: "solar:box-bold",             separator: true },
  { value: "manuallyAdded", labelKey: "profiles.v3.filter.manuallyAdded",  icon: "solar:hand-stars-bold" },
  { value: "noriskIssues",  labelKey: "profiles.v3.filter.noriskIssues",   icon: "solar:danger-triangle-bold", separator: true, nrcOnly: true },
];

export function LocalContentTabV3<T extends LocalContentItem>({
  profile,
  contentType,
  getDisplayFileName,
  itemTypeName,
  itemTypeNamePlural,
  addContentButtonText,
  emptyStateIconOverride,
  onRefreshRequired,
}: LocalContentTabV3Props<T>) {
  const { t } = useTranslation();

  const manager = useLocalContentManager<T>({
    profile,
    contentType,
    getDisplayFileName,
    onRefreshRequired,
  });

  const accentColor = useThemeStore((s) => s.accentColor);
  const navigate = useNavigate();
  const { setActiveDropContext, registerRefreshCallback, unregisterRefreshCallback } = useAppDragDropStore();

  // Map LocalContentType → BackendContentType fuer den Drag-Drop-Store
  const backendContentType = contentType as BackendContentType;

  // Drag-Drop-Context registrieren: damit Dateien die auf das Fenster gezogen
  // werden als Import fuer DIESEN Tab erkannt werden. Unregister bei Unmount.
  // WICHTIG: `manager` nicht in Deps — das Objekt ist jede Render neu
  // (returnt vom Hook), sonst Endlos-Loop.
  const fetchDataRef = useRef(manager.fetchData);
  fetchDataRef.current = manager.fetchData;
  useEffect(() => {
    if (!profile?.id) return;
    setActiveDropContext(profile.id, backendContentType);
    const refresh = () => fetchDataRef.current(true);
    registerRefreshCallback(backendContentType, refresh);
    return () => {
      setActiveDropContext(null, null);
      unregisterRefreshCallback(backendContentType);
    };
  }, [profile?.id, backendContentType, setActiveDropContext, registerRefreshCallback, unregisterRefreshCallback]);

  // Navigation zur Mod-Detail-Page wenn Modrinth/CurseForge-Projekt
  const navigateToModDetail = useCallback((item: LocalContentItem) => {
    if (item.modrinth_info?.project_id) {
      navigate(`/mods/modrinth/${item.modrinth_info.project_id}`);
    } else if (item.curseforge_info?.project_id) {
      navigate(`/mods/curseforge/${item.curseforge_info.project_id}`);
    }
  }, [navigate]);

  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [hoverMenuId, setHoverMenuId] = useState<string | null>(null);

  // ── Version-Switcher-State (pro Item) ─────────────────────────────────────
  const [openVersionKey, setOpenVersionKey] = useState<string | null>(null);
  const [versionCache, setVersionCache] = useState<Record<string, UnifiedVersion[]>>({});
  const [loadingVersionsFor, setLoadingVersionsFor] = useState<Record<string, boolean>>({});
  const [versionErrorFor, setVersionErrorFor] = useState<Record<string, string | null>>({});
  const [switchingVersionFor, setSwitchingVersionFor] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  const tileKey = useCallback((item: LocalContentItem): string => item.path_str || item.filename, []);

  const getItemPlatformAndProjectId = useCallback((item: LocalContentItem): { platform: ModPlatform | null; projectId: string | null } => {
    const plat = item.platform;
    if (plat === ModPlatform.Modrinth) return { platform: plat, projectId: item.modrinth_info?.project_id ?? null };
    if (plat === ModPlatform.CurseForge) return { platform: plat, projectId: item.curseforge_info?.project_id ?? null };
    // Fallback
    if (item.modrinth_info?.project_id)  return { platform: ModPlatform.Modrinth,   projectId: item.modrinth_info.project_id };
    if (item.curseforge_info?.project_id) return { platform: ModPlatform.CurseForge, projectId: item.curseforge_info.project_id };
    return { platform: null, projectId: null };
  }, []);

  const handleOpenVersionDropdown = useCallback(async (item: LocalContentItem) => {
    const key = tileKey(item);
    const willOpen = openVersionKey !== key;
    setOpenVersionKey(willOpen ? key : null);
    if (!willOpen) return;
    if (versionCache[key]) return;

    const { platform, projectId } = getItemPlatformAndProjectId(item);
    if (!platform || !projectId) {
      setVersionErrorFor(prev => ({ ...prev, [key]: t("profiles.v3.versions.noProject") }));
      return;
    }
    setLoadingVersionsFor(prev => ({ ...prev, [key]: true }));
    setVersionErrorFor(prev => ({ ...prev, [key]: null }));
    try {
      const response = await UnifiedService.getModVersions({
        source: platform,
        project_id: projectId,
        loaders: contentType === "Mod" && profile?.loader ? [profile.loader] : undefined,
        game_versions: profile?.game_version ? [profile.game_version] : undefined,
      });
      setVersionCache(prev => ({ ...prev, [key]: response.versions }));
    } catch (err) {
      console.error("[V3] Failed to load versions:", err);
      setVersionErrorFor(prev => ({ ...prev, [key]: t("profiles.v3.versions.loadFailed") }));
    } finally {
      setLoadingVersionsFor(prev => ({ ...prev, [key]: false }));
    }
  }, [openVersionKey, versionCache, getItemPlatformAndProjectId, contentType, profile, tileKey]);

  const handleSwitchVersion = useCallback(async (item: LocalContentItem, newVersion: UnifiedVersion) => {
    setOpenVersionKey(null);
    setSwitchingVersionFor(item.filename);
    try {
      await manager.handleSwitchContentVersion(item as T, newVersion);
    } catch (err) {
      console.error("[V3] Failed to switch version:", err);
      toast.error(t("profiles.v3.versions.switchFailed"));
    } finally {
      setSwitchingVersionFor(null);
    }
  }, [manager, t]);

  // Batch Enable/Disable — iteriert Selection und toggelt nur die Mods,
  // deren aktueller State vom Ziel abweicht.
  const handleBatchEnable = useCallback(async () => {
    const targets: T[] = [];
    for (const id of manager.selectedItemIds) {
      const item = manager.items.find(i => i.filename === id);
      if (item && item.is_disabled) targets.push(item);
    }
    if (targets.length === 0) {
      manager.handleSelectAllToggle(false);
      return;
    }
    setBatchProgress({ current: 0, total: targets.length });
    try {
      for (let i = 0; i < targets.length; i++) {
        await manager.handleToggleItemEnabled(targets[i]);
        setBatchProgress({ current: i + 1, total: targets.length });
      }
    } finally {
      setBatchProgress(null);
      manager.handleSelectAllToggle(false);
    }
  }, [manager]);

  const handleBatchDisable = useCallback(async () => {
    const targets: T[] = [];
    for (const id of manager.selectedItemIds) {
      const item = manager.items.find(i => i.filename === id);
      if (item && !item.is_disabled) targets.push(item);
    }
    if (targets.length === 0) {
      manager.handleSelectAllToggle(false);
      return;
    }
    setBatchProgress({ current: 0, total: targets.length });
    try {
      for (let i = 0; i < targets.length; i++) {
        await manager.handleToggleItemEnabled(targets[i]);
        setBatchProgress({ current: i + 1, total: targets.length });
      }
    } finally {
      setBatchProgress(null);
      manager.handleSelectAllToggle(false);
    }
  }, [manager]);

  // Batch Pause/Resume Update-Checks — zielt auf Mehrheits-Zustand:
  // Wenn >= die Haelfte aktiv, wird pausiert. Sonst wieder aktiviert.
  const batchUpdateChecksConfig = useMemo(() => {
    const selectedItems = Array.from(manager.selectedItemIds)
      .map(id => manager.items.find(i => i.filename === id))
      .filter((i): i is T => !!i && !!i.id);
    if (selectedItems.length === 0) return null;
    const activeCount = selectedItems.filter(i => (i.updates_enabled ?? true)).length;
    const pausedCount = selectedItems.length - activeCount;
    const shouldEnable = pausedCount >= activeCount;
    return { shouldEnable, count: selectedItems.length };
  }, [manager.selectedItemIds, manager.items]);

  const handleBatchToggleUpdateChecks = useCallback(async () => {
    if (!batchUpdateChecksConfig) return;
    await manager.handleBatchToggleSelectedUpdatesEnabled(batchUpdateChecksConfig.shouldEnable);
    manager.handleSelectAllToggle(false);
  }, [manager, batchUpdateChecksConfig]);

  const isNrc = contentType === "NoRiskMod";
  const selectedPackId = profile?.selected_norisk_pack_id ?? null;

  // Flagsmith blocked-mods Config laden wenn ein NRC-Pack aktiv ist.
  // Beeinflusst die Warn-Overlays auf Mods die mit NoRisk inkompatibel sind.
  const [isBlockedConfigLoaded, setIsBlockedConfigLoaded] = useState(false);
  useEffect(() => {
    if (profile?.selected_norisk_pack_id) {
      FlagsmithService.getBlockedModsConfig()
        .then(() => setIsBlockedConfigLoaded(true))
        .catch((err) => {
          console.error("[V3] Failed to load NoRisk blocked mods config:", err);
          setIsBlockedConfigLoaded(false);
        });
    } else {
      setIsBlockedConfigLoaded(false);
    }
  }, [profile?.selected_norisk_pack_id]);

  // Helper: hat ein Item ein verfuegbares Update? Matched die Logik aus dem
  // Render-Loop (siehe `updateAvailable` unten) — manager.contentUpdates wird
  // per `update-identifier` indiziert.
  const hasUpdate = useCallback((item: LocalContentItem) => {
    const key = getUpdateIdentifier(item);
    return !!(key && manager.contentUpdates[key]);
  }, [manager.contentUpdates]);

  const visibleItems = useMemo(() => {
    let list = manager.filteredItems;

    switch (filter) {
      case "enabled":       list = list.filter(i => !i.is_disabled); break;
      case "disabled":      list = list.filter(i =>  i.is_disabled); break;
      case "hasUpdate":     list = list.filter(hasUpdate); break;
      case "fromModpack":   list = list.filter(i => !!i.modpack_origin); break;
      case "manuallyAdded": list = list.filter(i => !i.modpack_origin && !i.norisk_info); break;
      case "updatesPaused": list = list.filter(i => i.updates_enabled === false); break;
      case "noriskIssues":  list = list.filter(i => {
        if (!isBlockedConfigLoaded) return false;
        const status = FlagsmithService.getModNoRiskStatus(
          i.filename,
          i.modrinth_info?.project_id || i.curseforge_info?.project_id,
          i.modrinth_info?.version_id || (i.curseforge_info as any)?.file_id,
        );
        return status === "blocked" || status === "warning";
      }); break;
    }

    const sorted = [...list];
    switch (sortBy) {
      case "name":
        sorted.sort((a, b) => getDisplayFileName(a).localeCompare(getDisplayFileName(b)));
        break;
      case "size":
        sorted.sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0));
        break;
      case "type":
        sorted.sort((a, b) => manager.getItemPlatformDisplayName(a).localeCompare(manager.getItemPlatformDisplayName(b)));
        break;
      case "updates":
        // Mods mit Update zuerst, danach alphabetisch.
        sorted.sort((a, b) => {
          const ua = hasUpdate(a) ? 1 : 0;
          const ub = hasUpdate(b) ? 1 : 0;
          if (ua !== ub) return ub - ua;
          return getDisplayFileName(a).localeCompare(getDisplayFileName(b));
        });
        break;
    }
    return sorted;
  }, [manager.filteredItems, filter, sortBy, getDisplayFileName, manager, hasUpdate, isBlockedConfigLoaded]);

  // "Add content" opens an in-place side sheet instead of navigating to a
  // dedicated browse route, so the profile view stays mounted and the
  // install-then-see-in-list feedback loop doesn't require a page-nav.
  // NoRisk mods are gated off the sheet since they come via the pack
  // selector, not Modrinth browse.
  const canBrowse = contentType !== "NoRiskMod";
  const [isBrowseSheetOpen, setBrowseSheetOpen] = useState(false);
  const handleAddClick = useCallback(() => {
    setBrowseSheetOpen(true);
  }, []);
  const handleBrowseSheetClose = useCallback(() => {
    setBrowseSheetOpen(false);
    // Refresh in case the user installed something while the sheet was open.
    manager.fetchData(true);
  }, [manager]);

  const sortDropdownOptions: DropdownOption[] = useMemo(
    () => SORT_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey), icon: o.icon })),
    [t],
  );
  const filterDropdownOptions: DropdownOption[] = useMemo(
    () => FILTER_OPTIONS
      .filter(opt => !opt.nrcOnly || isBlockedConfigLoaded)
      .map(o => ({ value: o.value, label: t(o.labelKey), icon: o.icon, separator: o.separator })),
    [t, isBlockedConfigLoaded],
  );

  // Loading-Spinner erst nach 500ms zeigen: schnelle Loads (Cache-Hit etc.)
  // rendern dann direkt die Liste statt kurz "Loading…" zu flashen.
  const shouldShowLoadingSpinner = useDelayedTrue(
    manager.isLoading && visibleItems.length === 0,
    500,
  );

  // Esc-Key clear'd Selection — `manager` nicht in Deps (neu per Render).
  const selectAllToggleRef = useRef(manager.handleSelectAllToggle);
  selectAllToggleRef.current = manager.handleSelectAllToggle;
  const hasSelection = manager.selectedItemIds.size > 0;
  useEffect(() => {
    if (!hasSelection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") selectAllToggleRef.current(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasSelection]);

  // FAB-Actions: Enable / Disable / (optional) Update-Check-Toggle / Delete.
  const batchBusy = manager.isBatchToggling || !!batchProgress;
  const fabActions: FABActionConfig[] = [
    { icon: "solar:play-bold",  label: t("profiles.v3.fab.enable"),  onClick: handleBatchEnable,  disabled: batchBusy },
    { icon: "solar:pause-bold", label: t("profiles.v3.fab.disable"), onClick: handleBatchDisable, disabled: batchBusy },
    ...(batchUpdateChecksConfig ? [{
      icon: batchUpdateChecksConfig.shouldEnable ? "solar:volume-loud-bold" : "solar:volume-cross-bold",
      label: t(batchUpdateChecksConfig.shouldEnable ? "profiles.v3.fab.resumeChecks" : "profiles.v3.fab.muteChecks"),
      onClick: handleBatchToggleUpdateChecks,
    } as FABActionConfig] : []),
    {
      icon: "solar:trash-bin-trash-bold",
      label: manager.isBatchDeleting ? "…" : t("profiles.v3.fab.delete"),
      tone: "danger",
      onClick: manager.handleBatchDeleteSelected,
      disabled: manager.isBatchDeleting,
    },
  ];

  const toolbarActions: ContentActionButton[] = [
    ...(manager.updatableContentCount > 0 ? [{
      id: "update-all",
      label: manager.isUpdatingAll
        ? t("profiles.v3.toolbar.updateAll")
        : `${t("profiles.v3.toolbar.updateAll")} (${manager.updatableContentCount})`,
      icon: manager.isUpdatingAll || manager.isCheckingUpdates ? "solar:refresh-bold" : "solar:refresh-circle-bold",
      variant: "highlight" as const,
      disabled: manager.isUpdatingAll,
      loading: manager.isUpdatingAll || manager.isCheckingUpdates,
      tooltip: t("profiles.v3.toolbar.updateAllTitle", { count: manager.updatableContentCount }),
      onClick: manager.handleUpdateAllAvailableContent,
    }] : []),
    {
      id: "refresh",
      icon: "solar:refresh-bold",
      variant: "text" as const,
      disabled: manager.isAnyTaskRunning,
      loading: manager.isAnyTaskRunning,
      tooltip: t("profiles.v3.toolbar.refresh"),
      onClick: () => manager.fetchData(false),
    },
    ...(canBrowse ? [{
      id: "add",
      label: addContentButtonText,
      icon: "solar:add-circle-bold",
      variant: "highlight" as const,
      tooltip: addContentButtonText,
      onClick: handleAddClick,
    }] : []),
  ];

  return (
    <div className="flex flex-col min-h-0 flex-1 relative">
      {/* ── Sticky Toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-white/10 flex-shrink-0 bg-black/20 sticky top-0 z-10">
        <SearchWithFilters
          searchValue={manager.searchQuery}
          onSearchChange={manager.setSearchQuery}
          placeholder={t("profiles.v3.toolbar.searchPlaceholder", { type: itemTypeNamePlural.toLowerCase() })}
          sortOptions={sortDropdownOptions}
          sortValue={sortBy}
          onSortChange={(v) => setSortBy(v as SortKey)}
          filterOptions={filterDropdownOptions}
          filterValue={filter}
          onFilterChange={(v) => setFilter(v as FilterKey)}
          dropdownSize="sm"
          className="flex-1"
        />

        {/* NoRisk pack selector (only for NRC) */}
        {isNrc && (
          <NoriskPackSelector profile={profile} onChanged={onRefreshRequired} />
        )}

        {/* Update-Check-Error: auffaellig weil kritisch (Netzwerk/API-Problem). */}
        {manager.contentUpdateError && (
          <Tooltip content={manager.contentUpdateError}>
            <div className="h-9 px-3 rounded-lg bg-red-600/20 border border-red-500/30 text-white flex items-center gap-2 font-minecraft lowercase text-2xl">
              <Icon icon="solar:danger-triangle-bold" className="w-4 h-4" />
              <span style={{ transform: 'translateY(-0.075em)' }}>{t("profiles.v3.toolbar.checkFailed")}</span>
            </div>
          </Tooltip>
        )}

        <ContentActionButtons actions={toolbarActions} size="sm" />
      </div>

      {/* ── Content area ───────────────────────────────────────────────── */}
      <div className={`flex-1 min-h-0 overflow-y-auto p-5 ${manager.selectedItemIds.size > 0 ? "pb-24" : ""}`}>
        {manager.error && (
          <div className="mb-4 flex items-start gap-3 p-3 rounded-lg border border-rose-400/30 bg-rose-500/10">
            <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-rose-300 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-xs font-minecraft-ten text-rose-100 break-words">
              {manager.error}
            </div>
            <button
              onClick={() => manager.fetchData(true)}
              className="flex-shrink-0 h-7 px-2 rounded-md text-[10px] font-minecraft-ten uppercase tracking-wider text-rose-100 hover:bg-rose-500/20 transition-colors"
              title={t("profiles.v3.content.retry")}
            >
              {t("profiles.v3.content.retry")}
            </button>
          </div>
        )}
        {isNrc && !selectedPackId ? (
          <EmptyStateV3
            icon="solar:shield-check-bold-duotone"
            title={t("profiles.v3.content.noPackTitle")}
            hint={t("profiles.v3.content.noPackHint")}
          />
        ) : manager.isLoading && visibleItems.length === 0 ? (
          shouldShowLoadingSpinner ? (
            <div className="flex items-center justify-center h-40 text-white/40 font-minecraft-ten text-sm animate-in fade-in duration-300">
              <Icon icon="solar:refresh-bold" className="w-4 h-4 mr-2 animate-spin" />
              {t("profiles.v3.content.loading")}
            </div>
          ) : (
            <div className="h-40" />
          )
        ) : visibleItems.length === 0 ? (
          <EmptyStateV3
            icon={emptyStateIconOverride ?? "solar:widget-bold-duotone"}
            title={manager.searchQuery
              ? t("profiles.v3.content.noMatch", { type: itemTypeNamePlural.toLowerCase(), query: manager.searchQuery })
              : t("profiles.v3.content.noItems", { type: itemTypeNamePlural.toLowerCase() })}
            hint={canBrowse
              ? t("profiles.v3.content.emptyHint", { cta: addContentButtonText, type: itemTypeNamePlural.toLowerCase() })
              : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {visibleItems.map((item) => {
              const key = tileKey(item);
              const updateKey = getUpdateIdentifier(item);
              const updateAvailable = updateKey ? manager.contentUpdates[updateKey] ?? null : null;
              const noRiskStatus = isBlockedConfigLoaded
                ? FlagsmithService.getModNoRiskStatus(
                    item.filename,
                    item.modrinth_info?.project_id || item.curseforge_info?.project_id,
                    item.modrinth_info?.version_id || (item.curseforge_info as any)?.file_id,
                  )
                : null;
              return (
                <ContentTile
                  key={key}
                  item={item}
                  displayName={getDisplayFileName(item)}
                  iconUrl={manager.getItemIcon(item)}
                  platformLabel={manager.getItemPlatformDisplayName(item)}
                  busy={manager.itemBeingToggled === item.filename || manager.itemBeingDeleted === item.filename}
                  onToggle={() => manager.handleToggleItemEnabled(item)}
                  onDelete={() => manager.handleDeleteItem(item)}
                  onOpenFolder={() => manager.handleOpenItemFolder(item)}
                  onNameClick={(item.modrinth_info?.project_id || item.curseforge_info?.project_id) ? () => navigateToModDetail(item) : undefined}
                  menuOpen={hoverMenuId === item.filename}
                  onMenuToggle={(open) => setHoverMenuId(open ? item.filename : null)}
                  selectMode={manager.selectedItemIds.size > 0}
                  isSelected={manager.selectedItemIds.has(item.filename)}
                  onToggleSelection={() => manager.handleItemSelectionChange(item.filename, !manager.selectedItemIds.has(item.filename))}
                  onToggleUpdateChecks={item.id ? () => manager.handleToggleItemUpdatesEnabled(item) : undefined}
                  onQuickUpdate={updateAvailable
                    ? () => manager.handleUpdateContentItem(item, updateAvailable)
                    : undefined}
                  quickUpdateDisabled={!!updateAvailable && (() => {
                    const isFromModPack = !!item.modpack_origin;
                    return isFromModPack
                      ? item.updates_enabled !== true
                      : item.updates_enabled === false;
                  })()}
                  quickUpdateTooltip={updateAvailable
                    ? (
                      <div className="max-w-xs text-left">
                        <ModUpdateText
                          isFromModPack={!!item.modpack_origin}
                          updateVersion={updateAvailable}
                          currentVersion={(item.modrinth_info as any)?.version_number || (item.curseforge_info as any)?.version_number}
                          modpackOrigin={item.modpack_origin}
                          updatesEnabled={item.updates_enabled}
                        />
                      </div>
                    )
                    : undefined}
                  isQuickUpdating={manager.itemsBeingUpdated.has(item.filename)}
                  noRiskStatus={noRiskStatus}
                  versionDropdownOpen={openVersionKey === key}
                  availableVersions={versionCache[key] ?? null}
                  isLoadingVersions={!!loadingVersionsFor[key]}
                  versionError={versionErrorFor[key] ?? null}
                  onVersionClick={() => handleOpenVersionDropdown(item)}
                  onSwitchVersion={(v) => handleSwitchVersion(item, v)}
                  updateAvailable={updateAvailable}
                  isSwitchingVersion={switchingVersionFor === item.filename}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* ── Floating Action Bar ─────────────────────────────────────────── */}
      <FloatingActionBar
        visible={manager.selectedItemIds.size > 0 || !!batchProgress}
        count={manager.selectedItemIds.size}
        totalCount={visibleItems.length}
        accent={accentColor.value}
        allSelected={manager.areAllFilteredSelected}
        onSelectAll={() => manager.handleSelectAllToggle(true)}
        onClear={() => manager.handleSelectAllToggle(false)}
        batchProgress={batchProgress}
        actions={fabActions}
      />

      {/* Side-sheet replaces the old `/profilesv2/:id/browse/:type` route
          push — keeps the profile view mounted under the sheet and lets
          the install→see-in-list feedback loop happen without a page-nav
          round trip. */}
      <BrowseContentSideSheetV3
        open={isBrowseSheetOpen}
        profile={profile}
        contentType={contentType}
        onClose={handleBrowseSheetClose}
        onInstallSuccess={() => manager.fetchData(true)}
      />

      {/* Confirm-dialog for single and batch delete — the manager toggles
          `isConfirmDeleteDialogOpen` but leaves the UI to the consumer. */}
      <ConfirmDeleteDialog
        isOpen={manager.isConfirmDeleteDialogOpen}
        itemName={
          manager.itemToDeleteForDialog
            ? getDisplayFileName(manager.itemToDeleteForDialog as T)
            : `${manager.selectedItemIds.size} ${manager.selectedItemIds.size === 1 ? itemTypeName : itemTypeNamePlural}`
        }
        onClose={manager.handleCloseDeleteDialog}
        onConfirm={manager.handleConfirmDeletion}
        isDeleting={manager.isDialogActionLoading}
        title={
          manager.itemToDeleteForDialog
            ? t("content.delete_item_title", { name: getDisplayFileName(manager.itemToDeleteForDialog as T) })
            : t("content.delete_selected_title", { itemType: itemTypeNamePlural })
        }
      />
    </div>
  );
}
