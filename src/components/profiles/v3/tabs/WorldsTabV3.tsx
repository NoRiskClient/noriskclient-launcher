/**
 * WorldsTabV3 — Welten und Server eines Profils.
 *
 * Props-Shape gleich wie V2 WorldsTab damit der Parent (ProfileDetailViewV3)
 * 1:1 switchen kann.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import type { Profile } from "../../../../types/profile";
import type { WorldInfo, ServerInfo, ServerPingInfo, ServerListEdit } from "../../../../types/minecraft";
import * as WorldService from "../../../../services/world-service";
import { useThemeStore } from "../../../../store/useThemeStore";
import { useAppDragDropStore } from "../../../../store/appStore";
import { useGlobalModal } from "../../../../hooks/useGlobalModal";
import { useProfileLaunch } from "../../../../hooks/useProfileLaunch.tsx";
import { useDelayedTrue } from "../../../../hooks/useDelayedTrue";
import { SearchWithFilters } from "../../../ui/SearchWithFilters";
import { ContentActionButtons } from "../../../ui/ContentActionButtons";
import { ServerDialog } from "../../../modals/ServerDialog";
import { Chip, FILTER_CHIP_CLASS } from "../../settings/SettingsSection";
import { McServerRow, type ServerPingState } from "../shared/McServerRow";
import { McWorldRow } from "../shared/McWorldRow";
import { CheckboxV2 } from "../../../ui/CheckboxV2";
import { ConfirmDeleteDialog } from "../../../modals/ConfirmDeleteDialog";
import { CopyWorldDialog, type WorldCopy } from "../../../modals/CopyWorldDialog";
import { ThemedDropdown, ThemedDropdownItem } from "../shared/ThemedDropdown";
import { EmptyStateV3 } from "../shared/EmptyStateV3";
import { FloatingActionBar, useSelectAllUndo, type FABActionConfig } from "../shared/FloatingActionBar";
import { parseErrorMessage } from "../../../../utils/error-utils";
import { isEditableTarget, isGlobalModalOpen } from "../../../../utils/keyboard-guards";

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
type KindFilter = "all" | "worlds" | "servers";

const serverKey = (index: number) => `server:${index}`;

const SORT_OPTIONS: { value: SortKey; labelKey: string; icon: string }[] = [
  { value: "lastPlayed", labelKey: "worlds.sort.last_played", icon: "solar:clock-circle-bold" },
  { value: "name",       labelKey: "worlds.sort.name",        icon: "solar:sort-from-top-to-bottom-bold" },
];

export function WorldsTabV3({ profile, isActive = true, onRefresh, onLaunchRequest }: WorldsTabV3Props) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const { setActiveDropContext, registerWorldsRefreshCallback, unregisterWorldsRefreshCallback } = useAppDragDropStore();
  const { showModal, hideModal } = useGlobalModal();

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
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
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
      setSelectedIds(prev => new Set([...prev].filter(id => !id.startsWith("server:"))));

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

  const shownWorlds = kindFilter === "servers" ? [] : visibleWorlds;
  const shownServers = kindFilter === "worlds" ? [] : visibleServers;

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

  const editServers = useCallback(async (edit: ServerListEdit, message: string) => {
    let saved = false;
    try {
      await WorldService.editServersForProfile(profile.id, edit);
      toast.success(message);
      saved = true;
    } catch (err) {
      toast.error(parseErrorMessage(err));
    }
    await loadData();
    return saved;
  }, [profile.id, loadData]);

  const openServerDialog = useCallback((server?: ServerInfo) => {
    const modalId = "server-dialog";
    const index = server ? servers.indexOf(server) : -1;
    const expectedAddress = server?.address ?? "";
    showModal(modalId, (
      <ServerDialog
        initialName={server ? server.name ?? "" : undefined}
        initialAddress={expectedAddress}
        onClose={() => hideModal(modalId)}
        onSave={async (name, address) => {
          const label = name || address;
          const saved = await editServers(
            server
              ? { kind: "update", index, expectedAddress, name, address }
              : { kind: "add", name, address },
            t(server ? "profiles.v3.servers.saved" : "profiles.v3.servers.added", { name: label }),
          );
          if (saved) hideModal(modalId);
        }}
      />
    ));
  }, [servers, showModal, hideModal, editServers, t]);

  const handleRemoveServer = useCallback((server: ServerInfo) => {
    const modalId = "remove-server";
    const index = servers.indexOf(server);
    const expectedAddress = server.address ?? "";
    const label = server.name || expectedAddress;
    showModal(modalId, (
      <ConfirmDeleteDialog
        isOpen={true}
        itemName={label}
        onClose={() => hideModal(modalId)}
        onConfirm={async () => {
          if (await editServers({ kind: "remove", index, expectedAddress }, t("profiles.v3.servers.removed", { name: label }))) hideModal(modalId);
        }}
        title={t("profiles.v3.servers.removeTitle")}
        message={<p className="text-white/80 font-minecraft">{t("profiles.v3.servers.removeConfirm", { name: label })}</p>}
      />
    ));
  }, [servers, showModal, hideModal, editServers, t]);

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
        title={t("worlds.delete_title")}
        message={<p className="text-white/80 font-minecraft">{t("worlds.delete_confirm", { name: displayName })}</p>}
      />
    ));
  }, [profile.id, showModal, hideModal, loadData, t]);

  const handleCopy = useCallback((targets: WorldInfo[]) => {
    const modalId = "copy-worlds";
    const doCopy = async ({ targetProfileIds, copies }: { targetProfileIds: string[]; copies: WorldCopy[] }) => {
      const jobs = targetProfileIds.flatMap((targetProfileId) =>
        copies.map(({ world, name }) =>
          WorldService.copyWorld({
            source_profile_id: profile.id,
            source_world_folder: world.folder_name,
            target_profile_id: targetProfileId,
            target_world_name: name,
          }),
        ),
      );
      const first = copies[0];
      const toastId = toast.loading(jobs.length === 1
        ? t("worlds.copying", { name: first.name })
        : t("worlds.copying_many", { count: jobs.length }));
      const results = await Promise.allSettled(jobs);
      const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      const succeeded = results.length - failures.length;
      if (failures.length === 0) {
        toast.success(jobs.length === 1
          ? t("worlds.copy_success", { source: first.world.display_name ?? first.world.folder_name, target: first.name })
          : t("worlds.copy_success_many", { count: succeeded }), { id: toastId });
      } else if (succeeded === 0) {
        toast.error(t("worlds.copy_failed", { error: parseErrorMessage(failures[0].reason) }), { id: toastId });
      } else {
        toast.error(t("worlds.copy_partial", { succeeded, failed: failures.length, error: parseErrorMessage(failures[0].reason) }), { id: toastId });
      }
      if (succeeded > 0) {
        hideModal(modalId);
        setSelectedIds(new Set());
        if (targetProfileIds.includes(profile.id)) await loadData();
      }
    };
    showModal(modalId, (
      <CopyWorldDialog
        worlds={targets}
        onClose={() => hideModal(modalId)}
        onConfirm={doCopy}
      />
    ));
  }, [profile.id, showModal, hideModal, loadData, t]);

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
    const serverTargets = servers
      .map((server, index) => ({ index, expectedAddress: server.address ?? "" }))
      .filter(({ index }) => selectedIds.has(serverKey(index)));
    const count = targets.length + serverTargets.length;
    const modalId = "batch-delete-worlds";
    const doBatchDelete = async () => {
      setIsBatchDeleting(true);
      try {
        for (const w of targets) {
          try { await WorldService.deleteWorld(profile.id, w.folder_name); }
          catch (err) { console.error("[V3 Worlds] Delete failed for", w.folder_name, err); }
        }
        if (serverTargets.length > 0) {
          try { await WorldService.editServersForProfile(profile.id, { kind: "removeMany", entries: serverTargets }); }
          catch (err) { toast.error(parseErrorMessage(err)); }
        }
        toast.success(t("worlds.batch_delete_success", { count }));
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
        itemName={t("worlds.batch_delete_item_name", { count })}
        onClose={() => hideModal(modalId)}
        onConfirm={doBatchDelete}
        title={t("worlds.batch_delete_title")}
        message={<p className="text-white/80 font-minecraft">{t(serverTargets.length > 0 ? "profiles.v3.servers.batchRemoveConfirm" : "worlds.batch_delete_confirm", { count })}</p>}
      />
    ));
  }, [selectedIds, worlds, servers, profile.id, showModal, hideModal, loadData, t]);

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

  const clearSelectionRef = useRef(() => setSelectedIds(new Set()));
  clearSelectionRef.current = () => setSelectedIds(new Set());
  const hasSelection = selectedIds.size > 0;
  useEffect(() => {
    if (!hasSelection) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isEditableTarget(e.target) || isGlobalModalOpen()) return;
      clearSelectionRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasSelection]);

  const shouldShowLoading = useDelayedTrue(loading && worlds.length === 0, 500);

  const selectedWorlds = worlds.filter(w => selectedIds.has(w.folder_name));
  const fabActions: FABActionConfig[] = [
    ...(selectedWorlds.length > 0 ? [{
      icon: "solar:copy-bold",
      label: t("profiles.v3.fab.copy"),
      onClick: () => handleCopy(selectedWorlds),
      disabled: isBatchDeleting,
    }] : []),
    {
      icon: "solar:trash-bin-trash-bold",
      label: isBatchDeleting ? "…" : t("profiles.v3.fab.delete"),
      tone: "danger",
      onClick: handleBatchDelete,
      disabled: isBatchDeleting,
    },
  ];

  const selectableIds = [
    ...shownWorlds.map(w => w.folder_name),
    ...shownServers.map(server => serverKey(servers.indexOf(server))),
  ];
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.has(id));
  const selectAllUndo = useSelectAllUndo(
    allSelected,
    () => new Set(selectedIds),
    setSelectedIds,
    () => setSelectedIds(new Set(selectableIds)),
  );

  return (
    <div className="flex flex-col min-h-0 flex-1 relative">
      {/* ── Sticky Toolbar ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2.5 px-5 py-2.5 border-b border-white/10 flex-shrink-0 bg-black/20 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <SearchWithFilters
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            placeholder={t("worlds.search_placeholder")}
            sortOptions={SORT_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey), icon: opt.icon }))}
            sortValue={sortBy}
            onSortChange={(v) => setSortBy(v as SortKey)}
            showFilter={false}
            dropdownSize="sm"
            compact
            className="flex-1 min-w-0"
          />
          <ContentActionButtons
            size="sm"
            actions={[
              {
                id: "refresh",
                icon: "solar:refresh-bold",
                variant: "text",
                tooltip: t("profiles.v3.toolbar.refresh"),
                loading,
                onClick: handleManualRefresh,
              },
              {
                id: "add-server",
                label: t("profiles.v3.servers.add"),
                icon: "solar:add-circle-bold",
                variant: "text",
                onClick: () => openServerDialog(),
              },
              {
                id: "import-world",
                label: t("worlds.import_world"),
                icon: "solar:import-bold",
                variant: "text",
                onClick: handleImport,
              },
            ]}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Chip active={kindFilter === "all"} accent={accentColor.value} className={FILTER_CHIP_CLASS} onClick={() => setKindFilter("all")}>
            {t("profiles.v3.servers.filterAll")}
          </Chip>
          <Chip active={kindFilter === "worlds"} accent={accentColor.value} className={FILTER_CHIP_CLASS} onClick={() => setKindFilter("worlds")}>
            {t("profiles.v3.servers.filterWorlds")}
          </Chip>
          <Chip active={kindFilter === "servers"} accent={accentColor.value} className={FILTER_CHIP_CLASS} onClick={() => setKindFilter("servers")}>
            {t("profiles.v3.servers.filter")}
          </Chip>
        </div>
      </div>

      {/* ── Content area ───────────────────────────────────────────────── */}
      <div className={`flex-1 min-h-0 overflow-y-auto p-5 ${selectedIds.size > 0 ? "pb-24" : ""}`}>
        {error && (
          <div className="mb-4 flex items-start gap-3 p-3 rounded-lg border border-rose-400/30 bg-rose-500/10">
            <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-rose-300 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-xs font-minecraft text-rose-100 break-words">{error}</div>
            <button
              onClick={() => loadData()}
              className="flex-shrink-0 h-7 px-2 rounded-md text-[10px] font-minecraft uppercase tracking-wider text-rose-100 hover:bg-rose-500/20 transition-colors"
            >
              {t("profiles.v3.content.retry")}
            </button>
          </div>
        )}

        {loading && worlds.length === 0 && servers.length === 0 ? (
          shouldShowLoading ? (
            <div className="flex items-center justify-center h-40 text-white/40 font-minecraft text-sm animate-in fade-in duration-300">
              <Icon icon="svg-spinners:ring-resize" className="w-4 h-4 mr-2" />
              {t("profiles.v3.content.loading")}
            </div>
          ) : (
            <div className="h-40" />
          )
        ) : shownWorlds.length === 0 && shownServers.length === 0 ? (
          <EmptyStateV3
            icon="solar:planet-bold"
            title={searchQuery ? t("worlds.no_match_search", { query: searchQuery }) : t("worlds.none_found")}
            hint={searchQuery ? undefined : t("worlds.create_in_minecraft")}
          />
        ) : (
          // Eine gemischte Liste: Worlds zuerst (sortiert), Servers danach
          // in servers.dat-Reihenfolge. Keine expliziten Section-Header —
          // Planet- vs Server-Icon differenzieren visuell schon.
          <div className="flex flex-col gap-1">
            {shownWorlds.map((world) => (
              <WorldTile
                key={`world:${world.folder_name}`}
                world={world}
                accentColor={accentColor.value}
                isSelected={selectedIds.has(world.folder_name)}
                selectMode={selectedIds.size > 0}
                isLaunching={isLaunching}
                onToggleSelection={() => toggleSelection(world.folder_name)}
                onPlay={() => handlePlay(world)}
                onCopy={() => handleCopy([world])}
                onOpenFolder={() => handleOpenFolder(world)}
                onDelete={() => handleDelete(world)}
                menuOpen={hoverMenuId === world.folder_name}
                onMenuToggle={(open) => setHoverMenuId(open ? world.folder_name : null)}
              />
            ))}
            {shownServers.map((server) => {
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
                  isSelected={selectedIds.has(serverKey(servers.indexOf(server)))}
                  selectMode={selectedIds.size > 0}
                  onToggleSelection={() => toggleSelection(serverKey(servers.indexOf(server)))}
                  onEdit={() => openServerDialog(server)}
                  onRemove={() => handleRemoveServer(server)}
                />
              );
            })}
          </div>
        )}
      </div>

      <FloatingActionBar
        visible={selectedIds.size > 0}
        count={selectedIds.size}
        totalCount={selectableIds.length}
        accent={accentColor.value}
        allSelected={allSelected}
        onSelectAll={selectAllUndo.onSelectAll}
        onRestore={selectAllUndo.onRestore}
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
  return (
    <McListRow selected={isSelected} accentColor={accentColor}>
      <SelectBox selected={isSelected} selectMode={selectMode} onToggle={onToggleSelection} />
      <McWorldRow world={world} onPlay={onPlay} playDisabled={isLaunching} />
      <RowActions visible={menuOpen}>
        <RowMenu open={menuOpen} onToggle={onMenuToggle}>
          <ThemedDropdownItem icon="solar:copy-bold" onClick={() => { onCopy(); onMenuToggle(false); }}>
            {t("worlds.copy")}
          </ThemedDropdownItem>
          <ThemedDropdownItem icon="solar:folder-open-bold" onClick={() => { onOpenFolder(); onMenuToggle(false); }}>
            {t("profiles.v3.tile.openFolder")}
          </ThemedDropdownItem>
          <ThemedDropdownItem icon="solar:trash-bin-trash-bold" tone="danger" onClick={() => { onDelete(); onMenuToggle(false); }}>
            {t("profiles.v3.tile.delete")}
          </ThemedDropdownItem>
        </RowMenu>
      </RowActions>
    </McListRow>
  );
};

const McListRow: React.FC<{ selected?: boolean; accentColor?: string; children: React.ReactNode }> = ({ selected, accentColor, children }) => (
  <div
    style={selected && accentColor ? { backgroundColor: `${accentColor}1a`, borderColor: `${accentColor}66` } : undefined}
    className={`group relative flex items-center gap-2 p-1 rounded-lg border transition-colors ${selected ? "" : "border-transparent hover:bg-white/5"}`}
  >
    {children}
  </div>
);

const SelectBox: React.FC<{ selected: boolean; selectMode: boolean; onToggle: () => void }> = ({ selected, selectMode, onToggle }) => {
  const { t } = useTranslation();
  return (
    <div className={`flex-shrink-0 transition-opacity ${selectMode || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
      <CheckboxV2
        size="sm"
        checked={selected}
        onChange={onToggle}
        tooltip={selected ? t("profiles.v3.tile.deselect") : t("profiles.v3.tile.select")}
      />
    </div>
  );
};

const RowActions: React.FC<{ visible: boolean; children: React.ReactNode }> = ({ visible, children }) => (
  <div className={`flex items-center shrink-0 transition-opacity ${visible ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
    {children}
  </div>
);

const RowMenu: React.FC<{ open: boolean; onToggle: (open: boolean) => void; children: React.ReactNode }> = ({ open, onToggle, children }) => (
  <div className="relative">
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(!open); }}
      className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10"
    >
      <Icon icon="solar:menu-dots-bold" className="w-4 h-4" />
    </button>
    <ThemedDropdown open={open} onClose={() => onToggle(false)} width="w-52">
      {children}
    </ThemedDropdown>
  </div>
);

// ─── Server Tile ────────────────────────────────────────────────────────────
interface ServerTileProps {
  server: ServerInfo;
  pingState: ServerPingState;
  isLaunching: boolean;
  menuOpen: boolean;
  onMenuToggle: (open: boolean) => void;
  onJoin: () => void;
  onReping: () => void;
  isSelected: boolean;
  selectMode: boolean;
  onToggleSelection: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

const ServerTile: React.FC<ServerTileProps> = ({
  server, pingState, isLaunching, menuOpen, onMenuToggle, onJoin, onReping,
  isSelected, selectMode, onToggleSelection, onEdit, onRemove,
}) => {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor.value);
  const name = server.name ?? server.address ?? "—";
  const address = server.address ?? "";

  return (
    <McListRow selected={isSelected} accentColor={accentColor}>
      <SelectBox selected={isSelected} selectMode={selectMode} onToggle={onToggleSelection} />
      <McServerRow
        name={name}
        pingState={pingState}
        savedIcon={server.icon_base64}
        className="flex-1 min-w-0"
        onPlay={address ? onJoin : undefined}
        playDisabled={isLaunching}
      />
      <RowActions visible={menuOpen}>
        <RowMenu open={menuOpen} onToggle={onMenuToggle}>
          <ThemedDropdownItem icon="solar:refresh-bold" onClick={() => { onReping(); onMenuToggle(false); }}>
            {t("profiles.v3.servers.reping")}
          </ThemedDropdownItem>
          <ThemedDropdownItem
            icon="solar:clipboard-bold"
            onClick={() => { if (address) navigator.clipboard.writeText(address); onMenuToggle(false); }}
          >
            {t("profiles.v3.servers.copyAddress")}
          </ThemedDropdownItem>
          <ThemedDropdownItem icon="solar:pen-bold" onClick={() => { onEdit(); onMenuToggle(false); }}>
            {t("profiles.v3.servers.edit")}
          </ThemedDropdownItem>
          <ThemedDropdownItem icon="solar:trash-bin-trash-bold" tone="danger" onClick={() => { onRemove(); onMenuToggle(false); }}>
            {t("profiles.v3.servers.remove")}
          </ThemedDropdownItem>
        </RowMenu>
      </RowActions>
    </McListRow>
  );
};
