"use client";

/**
 * WorldsTabV3 — funktionale Version (worlds only).
 *
 * Servers bekommen spaeter einen eigenen Left-Rail-Entry + ServersTabV3.
 * Props-Shape gleich wie V2 WorldsTab damit der Parent (ProfileDetailViewV3)
 * 1:1 switchen kann.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import type { Profile } from "../../../../types/profile";
import type { WorldInfo, ServerInfo, ServerPingInfo } from "../../../../types/minecraft";
import * as WorldService from "../../../../services/world-service";
import { parseMotdToHtml } from "../../../../utils/motd-utils";
import { useThemeStore } from "../../../../store/useThemeStore";
import { useAppDragDropStore } from "../../../../store/appStore";
import { useProfileStore } from "../../../../store/profile-store";
import { useGlobalModal } from "../../../../hooks/useGlobalModal";
import { useProfileLaunch } from "../../../../hooks/useProfileLaunch.tsx";
import { useDelayedTrue } from "../../../../hooks/useDelayedTrue";
import { formatRelativeTime } from "../../../../utils/format-relative-time";
import { Tooltip } from "../../../ui/Tooltip";
import { ConfirmDeleteDialog } from "../../../modals/ConfirmDeleteDialog";
import { CopyWorldDialog } from "../../../modals/CopyWorldDialog";
import { ThemedDropdown, ThemedDropdownItem } from "../shared/ThemedDropdown";
import { EmptyStateV3 } from "../shared/EmptyStateV3";
import { FloatingActionBar, type FABActionConfig } from "../shared/FloatingActionBar";
import { parseErrorMessage } from "../../../../utils/error-utils";

interface WorldsTabV3Props {
  profile: Profile;
  isActive?: boolean;
  onRefresh?: () => void;
  onLaunchRequest?: (params: {
    profileId: string;
    quickPlaySingleplayer?: string;
    quickPlayMultiplayer?: string;
  }) => void;
}

type SortKey = "lastPlayed" | "name";

const SORT_OPTIONS: { value: SortKey; labelKey: string; icon: string }[] = [
  { value: "lastPlayed", labelKey: "worlds.sort.last_played", icon: "solar:clock-circle-bold" },
  { value: "name",       labelKey: "worlds.sort.name",        icon: "solar:sort-from-top-to-bottom-bold" },
];

const GAME_MODE_ICONS = [
  "solar:swords-bold",        // 0 Survival
  "solar:pallete-2-bold",     // 1 Creative
  "solar:compass-big-bold",   // 2 Adventure
  "solar:eye-bold",           // 3 Spectator
] as const;

export function WorldsTabV3({ profile, isActive = true, onRefresh, onLaunchRequest }: WorldsTabV3Props) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const { setActiveDropContext, registerWorldsRefreshCallback, unregisterWorldsRefreshCallback } = useAppDragDropStore();
  const { showModal, hideModal } = useGlobalModal();
  const { profiles: allProfiles, loading: isLoadingProfiles } = useProfileStore();

  // useProfileLaunch teilt den State ueber den Zustand-Store pro profileId
  // → `isLaunching` hier ist identisch zu dem im Parent (Hero-Play-Button).
  const { isLaunching, handleQuickPlayLaunch } = useProfileLaunch({
    profileId: profile.id,
    onLaunchSuccess: () => { /* noop */ },
    onLaunchError: (err) => console.error("[V3 Worlds] Launch error:", err),
  });

  // ── Data ──────────────────────────────────────────────────────────────────
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [serverPings, setServerPings] = useState<Record<string, ServerPingInfo | "pending" | "error">>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("lastPlayed");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hoverMenuId, setHoverMenuId] = useState<string | null>(null);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

  // `mounted` ref verhindert setState auf einem unmounted Component nachdem
  // async Pings zurueckkommen. Wird bei unmount/Profile-Wechsel zu false gesetzt.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Load worlds + servers ─────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    setError(null);
    try {
      const [ws, svs] = await Promise.all([
        WorldService.getWorldsForProfile(profile.id),
        WorldService.getServersForProfile(profile.id),
      ]);
      if (!mountedRef.current) return;
      setWorlds(ws);
      setServers(svs);

      // Ping-Status initial auf "pending" setzen und alle parallel pingen.
      // Ergebnisse kommen asynchron rein — UI zeigt Spinner bis dahin.
      // mountedRef-Check bei allen Responses damit kein setState nach unmount.
      const initial: Record<string, "pending"> = {};
      for (const s of svs) if (s.address) initial[s.address] = "pending";
      setServerPings(initial);
      for (const s of svs) {
        if (!s.address) continue;
        const addr = s.address;
        WorldService.pingMinecraftServer(addr)
          .then((info) => {
            if (mountedRef.current) setServerPings(prev => ({ ...prev, [addr]: info }));
          })
          .catch(() => {
            if (mountedRef.current) setServerPings(prev => ({ ...prev, [addr]: "error" }));
          });
      }
    } catch (err) {
      console.error("[V3 Worlds] Failed to load worlds/servers:", err);
      if (mountedRef.current) setError(parseErrorMessage(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [profile.id]);

  useEffect(() => {
    if (isActive) void loadData();
  }, [isActive, loadData]);

  // Drag-drop context + Worlds-Refresh-Callback registrieren.
  // Ref-Pattern damit `loadData`-Identitaet nicht den Effect neu feuert.
  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;
  useEffect(() => {
    if (!isActive || !profile?.id) return;
    setActiveDropContext(profile.id, null);
    registerWorldsRefreshCallback(() => loadDataRef.current());
    return () => {
      setActiveDropContext(null, null);
      unregisterWorldsRefreshCallback();
    };
  }, [isActive, profile?.id, setActiveDropContext, registerWorldsRefreshCallback, unregisterWorldsRefreshCallback]);

  // ── Sort + Filter ─────────────────────────────────────────────────────────
  const visibleWorlds = useMemo(() => {
    let list = worlds;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(w => (w.display_name ?? w.folder_name).toLowerCase().includes(q));
    }
    const sorted = [...list];
    if (sortBy === "lastPlayed") {
      sorted.sort((a, b) => (b.last_played ?? 0) - (a.last_played ?? 0));
    } else if (sortBy === "name") {
      sorted.sort((a, b) => (a.display_name ?? a.folder_name).localeCompare(b.display_name ?? b.folder_name));
    }
    return sorted;
  }, [worlds, searchQuery, sortBy]);

  const visibleServers = useMemo(() => {
    if (!searchQuery.trim()) return servers;
    const q = searchQuery.toLowerCase();
    return servers.filter(s => (s.name ?? "").toLowerCase().includes(q) || (s.address ?? "").toLowerCase().includes(q));
  }, [servers, searchQuery]);

  const activeSortLabel = t(SORT_OPTIONS.find(o => o.value === sortBy)?.labelKey ?? "worlds.sort.last_played");

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleJoin = useCallback((server: ServerInfo) => {
    if (!server.address) return;
    if (onLaunchRequest) {
      onLaunchRequest({ profileId: profile.id, quickPlayMultiplayer: server.address });
    } else {
      toast.success(t("profiles.toast.joining_server", { name: server.name ?? server.address }));
      handleQuickPlayLaunch(undefined, server.address);
    }
  }, [profile.id, onLaunchRequest, handleQuickPlayLaunch, t]);

  const handleRepingServer = useCallback((address: string) => {
    setServerPings(prev => ({ ...prev, [address]: "pending" }));
    WorldService.pingMinecraftServer(address)
      .then(info => { if (mountedRef.current) setServerPings(prev => ({ ...prev, [address]: info })); })
      .catch(() => { if (mountedRef.current) setServerPings(prev => ({ ...prev, [address]: "error" })); });
  }, []);

  const handlePlay = useCallback((world: WorldInfo) => {
    // Toast wird vom Parent (handleLaunchRequest) gefeuert wenn onLaunchRequest
    // uebergeben ist; wir toasten nur wenn wir den Fallback-Pfad nehmen.
    if (onLaunchRequest) {
      onLaunchRequest({ profileId: profile.id, quickPlaySingleplayer: world.folder_name });
    } else {
      toast.success(t("profiles.toast.launching_world", { name: world.display_name ?? world.folder_name }));
      handleQuickPlayLaunch(world.folder_name, undefined);
    }
  }, [profile.id, onLaunchRequest, handleQuickPlayLaunch, t]);

  const handleOpenFolder = useCallback(async (world: WorldInfo) => {
    if (!world.icon_path) {
      toast.error(t("worlds.path_not_available"));
      return;
    }
    try {
      await revealItemInDir(world.icon_path);
    } catch (err) {
      toast.error(t("worlds.open_folder_failed", { error: parseErrorMessage(err) }));
    }
  }, [t]);

  const handleDelete = useCallback((world: WorldInfo) => {
    const modalId = `delete-world-${world.folder_name}`;
    const displayName = world.display_name ?? world.folder_name;
    const doDelete = async () => {
      try {
        await toast.promise(
          WorldService.deleteWorld(profile.id, world.folder_name),
          {
            loading: t("worlds.deleting", { name: displayName }),
            success: t("worlds.delete_success", { name: displayName }),
            error: (err) => t("worlds.delete_failed", { error: parseErrorMessage(err) }),
          },
        );
        await loadData();
      } finally {
        hideModal(modalId);
      }
    };
    showModal(modalId, (
      <ConfirmDeleteDialog
        isOpen={true}
        itemName={displayName}
        onClose={() => hideModal(modalId)}
        onConfirm={doDelete}
        isDeleting={false}
        title={t("worlds.delete_title")}
        message={<p className="text-white/80 font-minecraft-ten">{t("worlds.delete_confirm", { name: displayName })}</p>}
      />
    ));
  }, [profile.id, showModal, hideModal, loadData, t]);

  const handleCopy = useCallback((world: WorldInfo) => {
    const modalId = `copy-world-${world.folder_name}`;
    const displayName = world.display_name ?? world.folder_name;
    const doCopy = async (params: { targetProfileId: string; targetWorldName: string }) => {
      try {
        await toast.promise(
          WorldService.copyWorld({
            source_profile_id: profile.id,
            source_world_folder: world.folder_name,
            target_profile_id: params.targetProfileId,
            target_world_name: params.targetWorldName,
          }),
          {
            loading: t("worlds.copying", { name: displayName }),
            success: t("worlds.copy_success", { name: params.targetWorldName }),
            error: (err) => t("worlds.copy_failed", { error: parseErrorMessage(err) }),
          },
        );
        hideModal(modalId);
        if (params.targetProfileId === profile.id) await loadData();
      } catch (err) {
        console.error("[V3 Worlds] Copy failed:", err);
      }
    };
    showModal(modalId, (
      <CopyWorldDialog
        isOpen={true}
        sourceWorldName={displayName}
        sourceProfileId={profile.id}
        availableProfiles={allProfiles}
        isLoadingProfiles={isLoadingProfiles}
        isCopying={false}
        onClose={() => hideModal(modalId)}
        onConfirm={doCopy}
      />
    ));
  }, [profile.id, showModal, hideModal, allProfiles, isLoadingProfiles, loadData, t]);

  const handleImport = useCallback(async () => {
    try {
      const selectedPath = await openDialog({
        directory: true,
        multiple: false,
        title: t("worlds.import_title"),
      });
      if (!selectedPath) return;
      const worldPath = typeof selectedPath === "string" ? selectedPath : selectedPath[0];
      if (!worldPath) return;

      const folderName = worldPath.split(/[/\\]/).pop() || "Imported World";
      await toast.promise(
        WorldService.importWorld(profile.id, worldPath, folderName),
        {
          loading: t("worlds.importing", { name: folderName }),
          success: t("worlds.import_success", { name: folderName }),
          error: (err) => t("worlds.import_failed", { error: parseErrorMessage(err) }),
        },
      );
      await loadData();
    } catch (err) {
      console.error("[V3 Worlds] Import failed:", err);
    }
  }, [profile.id, loadData, t]);

  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const targets = worlds.filter(w => selectedIds.has(w.folder_name));
    const modalId = "batch-delete-worlds";
    const doBatchDelete = async () => {
      setIsBatchDeleting(true);
      try {
        for (const w of targets) {
          try { await WorldService.deleteWorld(profile.id, w.folder_name); }
          catch (err) { console.error("[V3 Worlds] Delete failed for", w.folder_name, err); }
        }
        toast.success(t("worlds.batch_delete_success", { count: targets.length }));
        setSelectedIds(new Set());
        await loadData();
      } finally {
        setIsBatchDeleting(false);
        hideModal(modalId);
      }
    };
    showModal(modalId, (
      <ConfirmDeleteDialog
        isOpen={true}
        itemName={t("worlds.batch_delete_item_name", { count: targets.length })}
        onClose={() => hideModal(modalId)}
        onConfirm={doBatchDelete}
        isDeleting={isBatchDeleting}
        title={t("worlds.batch_delete_title")}
        message={<p className="text-white/80 font-minecraft-ten">{t("worlds.batch_delete_confirm", { count: targets.length })}</p>}
      />
    ));
  }, [selectedIds, worlds, profile.id, showModal, hideModal, loadData, isBatchDeleting, t]);

  const handleManualRefresh = useCallback(async () => {
    await loadData();
    onRefresh?.();
  }, [loadData, onRefresh]);

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Esc clears selection
  const clearSelectionRef = useRef(() => setSelectedIds(new Set()));
  clearSelectionRef.current = () => setSelectedIds(new Set());
  const hasSelection = selectedIds.size > 0;
  useEffect(() => {
    if (!hasSelection) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") clearSelectionRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasSelection]);

  const shouldShowLoading = useDelayedTrue(loading && worlds.length === 0, 500);

  const fabActions: FABActionConfig[] = [
    {
      icon: "solar:trash-bin-trash-bold",
      label: isBatchDeleting ? "…" : t("profiles.v3.fab.delete"),
      tone: "danger",
      onClick: handleBatchDelete,
      disabled: isBatchDeleting,
    },
  ];

  return (
    <div className="flex flex-col min-h-0 flex-1 relative">
      {/* ── Sticky Toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-5 h-12 border-b border-white/5 flex-shrink-0 bg-black/20 sticky top-0 z-10">
        <div className="relative w-64 flex-shrink-0">
          <Icon icon="solar:magnifer-linear" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("worlds.search_placeholder")}
            className="w-full h-8 pl-8 pr-3 rounded-md bg-white/5 border border-white/10 focus:border-white/25 outline-none text-sm text-white placeholder:text-white/30 font-minecraft-ten"
          />
        </div>

        <div className="relative">
          <button
            onClick={() => setSortMenuOpen(v => !v)}
            className="h-8 px-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-minecraft-ten text-white/70 flex items-center gap-1.5"
          >
            <Icon icon="solar:sort-vertical-bold" className="w-3.5 h-3.5" />
            {activeSortLabel}
            <Icon icon="solar:alt-arrow-down-linear" className="w-3 h-3 opacity-60" />
          </button>
          <ThemedDropdown open={sortMenuOpen} onClose={() => setSortMenuOpen(false)} width="w-48">
            {SORT_OPTIONS.map(opt => (
              <ThemedDropdownItem
                key={opt.value}
                icon={opt.icon}
                selected={sortBy === opt.value}
                onClick={() => { setSortBy(opt.value); setSortMenuOpen(false); }}
              >
                {t(opt.labelKey)}
              </ThemedDropdownItem>
            ))}
          </ThemedDropdown>
        </div>

        <div className="flex-1" />

        <button
          onClick={handleManualRefresh}
          disabled={loading}
          className="h-8 px-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white disabled:opacity-50 flex items-center transition-colors"
          title={t("profiles.v3.toolbar.refresh")}
        >
          <Icon icon="solar:refresh-bold" className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>

        <button
          onClick={handleImport}
          className="h-8 px-3 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 text-emerald-100 text-xs font-minecraft-ten uppercase tracking-wider flex items-center gap-1.5"
        >
          <Icon icon="solar:import-bold" className="w-4 h-4" />
          {t("worlds.import_world")}
        </button>
      </div>

      {/* ── Content area ───────────────────────────────────────────────── */}
      <div className={`flex-1 min-h-0 overflow-y-auto p-5 ${selectedIds.size > 0 ? "pb-24" : ""}`}>
        {error && (
          <div className="mb-4 flex items-start gap-3 p-3 rounded-lg border border-rose-400/30 bg-rose-500/10">
            <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-rose-300 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-xs font-minecraft-ten text-rose-100 break-words">{error}</div>
            <button
              onClick={() => loadData()}
              className="flex-shrink-0 h-7 px-2 rounded-md text-[10px] font-minecraft-ten uppercase tracking-wider text-rose-100 hover:bg-rose-500/20 transition-colors"
            >
              {t("profiles.v3.content.retry")}
            </button>
          </div>
        )}

        {loading && worlds.length === 0 && servers.length === 0 ? (
          shouldShowLoading ? (
            <div className="flex items-center justify-center h-40 text-white/40 font-minecraft-ten text-sm animate-in fade-in duration-300">
              <Icon icon="solar:refresh-bold" className="w-4 h-4 mr-2 animate-spin" />
              {t("profiles.v3.content.loading")}
            </div>
          ) : (
            <div className="h-40" />
          )
        ) : visibleWorlds.length === 0 && visibleServers.length === 0 ? (
          <EmptyStateV3
            icon="solar:planet-bold-duotone"
            title={searchQuery ? t("worlds.no_match_search", { query: searchQuery }) : t("worlds.none_found")}
            hint={searchQuery ? undefined : t("worlds.create_in_minecraft")}
          />
        ) : (
          // Eine gemischte Liste: Worlds zuerst (sortiert), Servers danach
          // in servers.dat-Reihenfolge. Keine expliziten Section-Header —
          // Planet- vs Server-Icon differenzieren visuell schon.
          <div className="flex flex-col gap-2">
            {visibleWorlds.map((world) => (
              <WorldTile
                key={`world:${world.folder_name}`}
                world={world}
                accentColor={accentColor.value}
                isSelected={selectedIds.has(world.folder_name)}
                selectMode={selectedIds.size > 0}
                isLaunching={isLaunching}
                onToggleSelection={() => toggleSelection(world.folder_name)}
                onPlay={() => handlePlay(world)}
                onCopy={() => handleCopy(world)}
                onOpenFolder={() => handleOpenFolder(world)}
                onDelete={() => handleDelete(world)}
                menuOpen={hoverMenuId === world.folder_name}
                onMenuToggle={(open) => setHoverMenuId(open ? world.folder_name : null)}
              />
            ))}
            {visibleServers.map((server) => {
              const address = server.address ?? "";
              const pingState = address ? serverPings[address] : undefined;
              return (
                <ServerTile
                  key={`server:${address || server.name || ""}`}
                  server={server}
                  pingState={pingState}
                  isLaunching={isLaunching}
                  menuOpen={hoverMenuId === `server:${address}`}
                  onMenuToggle={(open) => setHoverMenuId(open ? `server:${address}` : null)}
                  onJoin={() => handleJoin(server)}
                  onReping={() => address && handleRepingServer(address)}
                />
              );
            })}
          </div>
        )}
      </div>

      <FloatingActionBar
        visible={selectedIds.size > 0}
        count={selectedIds.size}
        totalCount={visibleWorlds.length}
        accent={accentColor.value}
        allSelected={selectedIds.size === visibleWorlds.length && visibleWorlds.length > 0}
        onSelectAll={() => setSelectedIds(new Set(visibleWorlds.map(w => w.folder_name)))}
        onClear={() => setSelectedIds(new Set())}
        actions={fabActions}
        batchProgress={null}
      />
    </div>
  );
}

// ─── World Tile ─────────────────────────────────────────────────────────────
interface WorldTileProps {
  world: WorldInfo;
  accentColor: string;
  isSelected: boolean;
  selectMode: boolean;
  isLaunching: boolean;
  onToggleSelection: () => void;
  onPlay: () => void;
  onCopy: () => void;
  onOpenFolder: () => void;
  onDelete: () => void;
  menuOpen: boolean;
  onMenuToggle: (open: boolean) => void;
}

const WorldTile: React.FC<WorldTileProps> = ({
  world, accentColor, isSelected, selectMode, isLaunching, onToggleSelection,
  onPlay, onCopy, onOpenFolder, onDelete, menuOpen, onMenuToggle,
}) => {
  const { t } = useTranslation();
  const displayName = world.display_name ?? world.folder_name;
  const lastPlayedIso = world.last_played ? new Date(world.last_played).toISOString() : null;
  const gameMode = world.game_mode ?? 0;
  const gameModeLabel = WorldService.getGameModeString(gameMode);
  const difficultyLabel = WorldService.getDifficultyString(world.difficulty ?? 0);
  const iconUrl = world.icon_path ? convertFileSrc(world.icon_path) : null;

  return (
    <div
      style={isSelected ? { backgroundColor: `${accentColor}1a`, borderColor: `${accentColor}66` } : undefined}
      className={`group relative flex items-center gap-3 p-3 rounded-lg border transition-colors ${
        isSelected
          ? ""
          : "bg-white/[0.03] border-white/10 hover:border-white/20 hover:bg-white/[0.06]"
      }`}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onToggleSelection(); }}
        className={`flex-shrink-0 transition-opacity ${selectMode || isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        title={isSelected ? t("profiles.v3.tile.deselect") : t("profiles.v3.tile.select")}
      >
        <div
          style={isSelected ? { backgroundColor: accentColor, borderColor: accentColor } : undefined}
          className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
            isSelected ? "" : "border-white/30 hover:border-white/60"
          }`}
        >
          {isSelected && <Icon icon="solar:check-read-linear" className="w-3 h-3 text-black" />}
        </div>
      </button>

      {/* World Icon */}
      <div className="relative w-16 h-16 flex-shrink-0 rounded-md bg-white/10 ring-1 ring-white/10 overflow-hidden flex items-center justify-center">
        {iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            className="w-full h-full object-cover"
            style={{ imageRendering: "pixelated" }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <Icon icon="solar:planet-bold-duotone" className="w-8 h-8 text-white/40" />
        )}
        {world.is_hardcore && (
          <div className="absolute top-0.5 right-0.5 bg-rose-500/80 text-white rounded-sm p-0.5">
            <Icon icon="solar:heart-broken-bold" className="w-3 h-3" />
          </div>
        )}
      </div>

      {/* Identity + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className="text-sm text-white font-minecraft-ten truncate normal-case" title={displayName}>
            {displayName}
          </div>
          {world.difficulty_locked && (
            <Tooltip content={t("worlds.difficulty_locked")}>
              <Icon icon="solar:lock-bold" className="w-3 h-3 text-white/30 flex-shrink-0" />
            </Tooltip>
          )}
        </div>

        <div className="flex items-center gap-1.5 mt-1 text-[11px] font-minecraft-ten">
          <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded text-white/70 bg-white/5">
            <Icon icon={GAME_MODE_ICONS[gameMode]} className="w-3 h-3" />
            {gameModeLabel}
          </span>
          <span className="text-white/40">·</span>
          <span className="text-white/60">{difficultyLabel}</span>
          {world.version_name && (
            <>
              <span className="text-white/40">·</span>
              <span className="text-white/50">{world.version_name}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 mt-1 text-xs font-minecraft-ten text-white/40">
          <Icon icon="solar:clock-circle-linear" className="w-3 h-3 flex-shrink-0" />
          <span>{formatRelativeTime(lastPlayedIso)}</span>
        </div>
      </div>

      <button
        onClick={onPlay}
        disabled={isLaunching}
        className={`h-8 px-3 rounded-md border flex items-center gap-1.5 flex-shrink-0 transition-colors text-xs font-minecraft-ten uppercase tracking-wider ${
          isLaunching
            ? "bg-emerald-500/10 border-emerald-400/20 text-emerald-200/60 cursor-wait"
            : "bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-400/30 text-emerald-100"
        }`}
      >
        <Icon
          icon={isLaunching ? "solar:refresh-bold" : "solar:play-bold"}
          className={`w-4 h-4 ${isLaunching ? "animate-spin" : ""}`}
        />
        {t("profiles.play")}
      </button>

      <div className="relative flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onMenuToggle(!menuOpen); }}
          className="p-1.5 rounded text-white/40 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Icon icon="solar:menu-dots-bold" className="w-4 h-4" />
        </button>
        <ThemedDropdown open={menuOpen} onClose={() => onMenuToggle(false)} width="w-52">
          <ThemedDropdownItem icon="solar:copy-bold" onClick={() => { onCopy(); onMenuToggle(false); }}>
            {t("worlds.copy")}
          </ThemedDropdownItem>
          <ThemedDropdownItem icon="solar:folder-linear" onClick={() => { onOpenFolder(); onMenuToggle(false); }}>
            {t("profiles.v3.tile.openFolder")}
          </ThemedDropdownItem>
          <ThemedDropdownItem icon="solar:trash-bin-trash-linear" tone="danger" onClick={() => { onDelete(); onMenuToggle(false); }}>
            {t("profiles.v3.tile.delete")}
          </ThemedDropdownItem>
        </ThemedDropdown>
      </div>
    </div>
  );
};

// ─── Server Tile ────────────────────────────────────────────────────────────
interface ServerTileProps {
  server: ServerInfo;
  pingState: ServerPingInfo | "pending" | "error" | undefined;
  isLaunching: boolean;
  menuOpen: boolean;
  onMenuToggle: (open: boolean) => void;
  onJoin: () => void;
  onReping: () => void;
}

const latencyDotColor = (ms: number): string => {
  if (ms < 80)  return "bg-emerald-400";
  if (ms < 150) return "bg-white/50";
  if (ms < 250) return "bg-amber-400";
  return "bg-rose-400";
};
const latencyTextColor = (ms: number): string => {
  if (ms < 80)  return "text-emerald-400";
  if (ms < 150) return "text-white/60";
  if (ms < 250) return "text-amber-400";
  return "text-rose-400";
};

const ServerTile: React.FC<ServerTileProps> = ({ server, pingState, isLaunching, menuOpen, onMenuToggle, onJoin, onReping }) => {
  const { t } = useTranslation();
  const name = server.name ?? server.address ?? "—";
  const address = server.address ?? "";
  const isPending = pingState === "pending";
  const isError = pingState === "error" || (pingState && typeof pingState === "object" && pingState.error);
  const ping = (pingState && typeof pingState === "object" && !pingState.error) ? pingState : null;

  // Favicon: ping liefert aktuelles (base64), fallback auf server.icon_base64 (aus servers.dat).
  const iconBase64 = ping?.favicon_base64 ?? server.icon_base64 ?? null;
  // MOTD: description_json hat Priority (enthaelt Chat-Component mit Farben),
  // description ist der plain-string-Fallback (oft ohne §-Codes).
  const motdInput = ping?.description_json ?? ping?.description ?? "";

  return (
    <div
      className={`group relative flex items-center gap-3 p-3 rounded-lg border transition-colors bg-white/[0.03] border-white/10 hover:border-white/20 hover:bg-white/[0.06] ${
        isError ? "opacity-60" : ""
      }`}
    >
      <div className="relative w-16 h-16 flex-shrink-0 rounded-md bg-white/10 ring-1 ring-white/10 overflow-hidden flex items-center justify-center">
        {iconBase64 ? (
          <img
            src={`data:image/png;base64,${iconBase64}`}
            alt=""
            className="w-full h-full object-cover"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <Icon icon="solar:server-bold-duotone" className="w-8 h-8 text-white/40" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="text-sm text-white font-minecraft-ten truncate normal-case" title={name}>{name}</div>
          {address && <span className="text-xs text-white/35 font-minecraft-ten truncate">· {address}</span>}
        </div>

        {isError ? (
          <div className="mt-1 text-xs text-rose-300/80 font-minecraft-ten truncate">
            {t("profiles.v3.servers.offline")}
          </div>
        ) : isPending ? (
          <div className="mt-1 text-xs text-white/35 font-minecraft-ten flex items-center gap-1.5">
            <Icon icon="solar:refresh-bold" className="w-3 h-3 animate-spin" />
            {t("profiles.v3.servers.pinging")}
          </div>
        ) : motdInput ? (
          <div
            className="mt-1 text-xs font-minecraft-ten whitespace-pre-line line-clamp-2 leading-snug"
            dangerouslySetInnerHTML={{ __html: parseMotdToHtml(motdInput) }}
          />
        ) : null}

        {ping && !isError && (
          <div className="flex items-center gap-2 mt-1 text-xs font-minecraft-ten">
            {ping.players_online != null && ping.players_max != null && (
              <>
                <span className="inline-flex items-center gap-1 text-white/60">
                  <Icon icon="solar:users-group-rounded-bold" className="w-3 h-3" />
                  <span className="tabular-nums">{ping.players_online}/{ping.players_max}</span>
                </span>
                <span className="text-white/20">·</span>
              </>
            )}
            {ping.latency_ms != null && (
              <span className={`inline-flex items-center gap-1 tabular-nums ${latencyTextColor(ping.latency_ms)}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${latencyDotColor(ping.latency_ms)}`} />
                {ping.latency_ms}ms
              </span>
            )}
            {ping.version_name && (
              <>
                <span className="text-white/20">·</span>
                <span className="text-white/40 truncate">{ping.version_name}</span>
              </>
            )}
          </div>
        )}
      </div>

      <button
        onClick={onJoin}
        disabled={!!isError || isLaunching || !address}
        className={`h-8 px-3 rounded-md border flex items-center gap-1.5 flex-shrink-0 transition-colors text-xs font-minecraft-ten uppercase tracking-wider ${
          isError || !address
            ? "bg-white/5 border-white/10 text-white/30 cursor-not-allowed"
            : isLaunching
              ? "bg-emerald-500/10 border-emerald-400/20 text-emerald-200/60 cursor-wait"
              : "bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-400/30 text-emerald-100"
        }`}
      >
        <Icon
          icon={isLaunching ? "solar:refresh-bold" : "solar:login-2-bold"}
          className={`w-4 h-4 ${isLaunching ? "animate-spin" : ""}`}
        />
        {t("profiles.v3.servers.joinShort")}
      </button>

      <div className="relative flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onMenuToggle(!menuOpen); }}
          className="p-1.5 rounded text-white/40 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Icon icon="solar:menu-dots-bold" className="w-4 h-4" />
        </button>
        <ThemedDropdown open={menuOpen} onClose={() => onMenuToggle(false)} width="w-52">
          <ThemedDropdownItem icon="solar:refresh-linear" onClick={() => { onReping(); onMenuToggle(false); }}>
            {t("profiles.v3.servers.reping")}
          </ThemedDropdownItem>
          <ThemedDropdownItem
            icon="solar:clipboard-linear"
            onClick={() => { if (address) navigator.clipboard.writeText(address); onMenuToggle(false); }}
          >
            {t("profiles.v3.servers.copyAddress")}
          </ThemedDropdownItem>
        </ThemedDropdown>
      </div>
    </div>
  );
};
