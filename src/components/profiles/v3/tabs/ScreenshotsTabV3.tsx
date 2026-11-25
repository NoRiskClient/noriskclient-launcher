/**
 * ScreenshotsTabV3 — Gallery-Grid mit Hover-Overlay + Fullscreen-Modal.
 * Ersetzt V2 ScreenshotsTab. Reused V2 ProfileScreenshotModal unveraendert.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { createPortal } from "react-dom";
import { useInView } from "react-intersection-observer";

import type { Profile } from "../../../../types/profile";
import type { ScreenshotInfo } from "../../../../types/profile";
import { getImageThumbnail } from "../../../../services/tauri-service";
import { useThemeStore } from "../../../../store/useThemeStore";
import { useDelayedTrue } from "../../../../hooks/useDelayedTrue";
import { formatRelativeTime } from "../../../../utils/format-relative-time";
import { ProfileScreenshotModal } from "../../ProfileScreenshotModal";
import { ConfirmDeleteDialog } from "../../../modals/ConfirmDeleteDialog";
import { useGlobalModal } from "../../../../hooks/useGlobalModal";
import { isEditableTarget, isGlobalModalOpen } from "../../../../utils/keyboard-guards";
import { SearchWithFilters } from "../../../ui/SearchWithFilters";
import { ContentActionButtons } from "../../../ui/ContentActionButtons";
import { CheckboxV2 } from "../../../ui/CheckboxV2";
import { EmptyStateV3 } from "../shared/EmptyStateV3";
import { FloatingActionBar, useSelectAllUndo, type FABActionConfig } from "../shared/FloatingActionBar";
import { parseErrorMessage } from "../../../../utils/error-utils";
import { useShareDialog } from "../../../../hooks/useShareDialog";
import { copyScreenshotImage, revealScreenshot } from "../../../../utils/screenshot-actions";
import { clampMenuPosition, SettingsContextMenu, type ContextMenuItem } from "../../../ui/SettingsContextMenu";

interface ScreenshotsTabV3Props {
  profile: Profile;
  isActive?: boolean;
}

type SortKey = "newest" | "oldest";

const SORT_OPTIONS: { value: SortKey; labelKey: string; icon: string }[] = [
  { value: "newest", labelKey: "profiles.v3.screenshots.sort.newest", icon: "solar:sort-from-top-to-bottom-bold" },
  { value: "oldest", labelKey: "profiles.v3.screenshots.sort.oldest", icon: "solar:sort-from-bottom-to-top-bold" },
];

const THUMBNAIL_SIZE = 512;

export function ScreenshotsTabV3({ profile, isActive = true }: ScreenshotsTabV3Props) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const { showModal, hideModal } = useGlobalModal();
  const { openShare, shareDialog, isSharing } = useShareDialog();

  // ── Data ──────────────────────────────────────────────────────────────────
  const [screenshots, setScreenshots] = useState<ScreenshotInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [modalScreenshot, setModalScreenshot] = useState<ScreenshotInfo | null>(null);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadData = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<ScreenshotInfo[]>("list_profile_screenshots", { profileId: profile.id });
      if (!mountedRef.current) return;
      setScreenshots(list);
      // Stale Selektions-Eintraege dropen — wenn Files extern geloescht
      // wurden, haette selectedPaths sonst tote Pfade.
      setSelectedPaths(prev => {
        if (prev.size === 0) return prev;
        const alive = new Set(list.map(s => s.path));
        const kept = new Set<string>();
        for (const p of prev) if (alive.has(p)) kept.add(p);
        return kept.size === prev.size ? prev : kept;
      });
    } catch (err) {
      console.error("[V3 Screenshots] Failed to load:", err);
      if (mountedRef.current) setError(parseErrorMessage(err));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [profile.id]);

  useEffect(() => {
    if (isActive) void loadData();
  }, [isActive, loadData]);

  // ── Sort ──────────────────────────────────────────────────────────────────
  const visibleScreenshots = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const sorted = q ? screenshots.filter(s => s.filename.toLowerCase().includes(q)) : [...screenshots];
    const toTs = (s: ScreenshotInfo) => s.modified ? new Date(s.modified).getTime() : 0;
    if (sortBy === "newest")  sorted.sort((a, b) => toTs(b) - toTs(a));
    else                      sorted.sort((a, b) => toTs(a) - toTs(b));
    return sorted;
  }, [screenshots, sortBy, searchQuery]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const toggleSelection = (path: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const confirmDelete = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    const single = paths.length === 1 ? screenshots.find(s => s.path === paths[0]) : undefined;
    const modalId = "delete-screenshots";
    const doDelete = async () => {
      setIsBatchDeleting(true);
      let successCount = 0;
      try {
        for (const p of paths) {
          try {
            await invoke("delete_file", { filePath: p });
            successCount++;
          } catch (err) {
            console.error("[V3 Screenshots] Delete failed for", p, err);
          }
        }
        if (single && successCount === 1) toast.success(t("screenshots.deleted", { name: single.filename }));
        else toast.success(t("profiles.v3.screenshots.batchDeleteSuccess", { count: successCount }));
        if (!single) setSelectedPaths(new Set());
        setModalScreenshot(prev => (prev && paths.includes(prev.path) ? null : prev));
        await loadData();
      } finally {
        setIsBatchDeleting(false);
        hideModal(modalId);
      }
    };
    showModal(modalId, single ? (
      <ConfirmDeleteDialog
        isOpen={true}
        itemName={single.filename}
        onClose={() => hideModal(modalId)}
        onConfirm={doDelete}
      />
    ) : (
      <ConfirmDeleteDialog
        isOpen={true}
        itemName={t("profiles.v3.screenshots.batchDeleteItemName", { count: paths.length })}
        onClose={() => hideModal(modalId)}
        onConfirm={doDelete}
        title={t("profiles.v3.screenshots.batchDeleteTitle")}
        message={<p className="text-white/80 font-minecraft">{t("profiles.v3.screenshots.batchDeleteConfirm", { count: paths.length })}</p>}
      />
    ));
  }, [screenshots, loadData, showModal, hideModal, t]);

  const modalIndex = modalScreenshot ? visibleScreenshots.findIndex(s => s.path === modalScreenshot.path) : -1;

  const navigate = useCallback((delta: -1 | 1) => {
    const next = visibleScreenshots[modalIndex + delta];
    if (next) setModalScreenshot(next);
  }, [visibleScreenshots, modalIndex]);

  const renameScreenshot = useCallback(async (name: string) => {
    if (!modalScreenshot) return;
    const oldPath = modalScreenshot.path;
    const newPath = await invoke<string>("rename_profile_screenshot", { profileId: profile.id, path: oldPath, name });
    const filename = newPath.split(/[\\/]/).pop() ?? newPath;
    const renamed = { ...modalScreenshot, path: newPath, filename };
    setScreenshots(prev => prev.map(s => (s.path === oldPath ? renamed : s)));
    setSelectedPaths(prev => {
      if (!prev.has(oldPath)) return prev;
      const next = new Set(prev);
      next.delete(oldPath);
      next.add(newPath);
      return next;
    });
    setModalScreenshot(renamed);
  }, [modalScreenshot, profile.id]);

  const handleBatchDelete = useCallback(() => confirmDelete(Array.from(selectedPaths)), [confirmDelete, selectedPaths]);

  const shareScreenshot = useCallback((s: ScreenshotInfo) => {
    void openShare(
      { kind: "screenshot", path: s.path, profileId: profile.id },
      { kind: "screenshot", name: s.filename, preview: convertFileSrc(s.path) },
    );
  }, [openShare, profile.id]);

  const screenshotModalOpen = modalScreenshot !== null;
  useEffect(() => {
    if (selectedPaths.size === 0 || screenshotModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isEditableTarget(e.target) || isGlobalModalOpen()) return;
      setSelectedPaths(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedPaths.size, screenshotModalOpen]);

  const shouldShowLoading = useDelayedTrue(loading && screenshots.length === 0, 500);

  const fabActions: FABActionConfig[] = [
    {
      icon: "solar:trash-bin-trash-bold",
      label: isBatchDeleting ? "…" : t("profiles.v3.fab.delete"),
      tone: "danger",
      onClick: handleBatchDelete,
      disabled: isBatchDeleting,
    },
  ];

  const allSelected = selectedPaths.size === visibleScreenshots.length && visibleScreenshots.length > 0;
  const selectAllUndo = useSelectAllUndo(
    allSelected,
    () => new Set(selectedPaths),
    setSelectedPaths,
    () => setSelectedPaths(new Set(visibleScreenshots.map(s => s.path))),
  );

  return (
    <div className="flex flex-col min-h-0 flex-1 relative">
      {/* ── Sticky Toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-white/10 flex-shrink-0 bg-black/20 sticky top-0 z-10">
        <SearchWithFilters
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          placeholder={t("profiles.v3.screenshots.search")}
          sortOptions={SORT_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey), icon: opt.icon }))}
          sortValue={sortBy}
          onSortChange={(v) => setSortBy(v as SortKey)}
          showFilter={false}
          dropdownSize="sm"
          compact
          className="flex-1 min-w-0"
        />
        <span className="text-xs text-white/40 font-minecraft tabular-nums whitespace-nowrap">
          {t("profiles.v3.screenshots.count", { count: screenshots.length })}
        </span>
        <ContentActionButtons
          size="sm"
          actions={[
            {
              id: "refresh",
              icon: "solar:refresh-bold",
              variant: "text",
              tooltip: t("profiles.v3.toolbar.refresh"),
              loading,
              onClick: loadData,
            },
          ]}
        />
      </div>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div className={`flex-1 min-h-0 overflow-y-auto p-5 ${selectedPaths.size > 0 ? "pb-24" : ""}`}>
        {error && (
          <div className="mb-4 flex items-start gap-3 p-3 rounded-lg border border-rose-400/30 bg-rose-500/10">
            <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-rose-300 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-xs font-minecraft text-rose-100 break-words">{error}</div>
            <button
              onClick={loadData}
              className="flex-shrink-0 h-7 px-2 rounded-md text-[10px] font-minecraft uppercase tracking-wider text-rose-100 hover:bg-rose-500/20 transition-colors"
            >
              {t("profiles.v3.content.retry")}
            </button>
          </div>
        )}

        {loading && screenshots.length === 0 ? (
          shouldShowLoading ? (
            <div className="flex items-center justify-center h-40 text-white/40 font-minecraft text-sm animate-in fade-in duration-300">
              <Icon icon="svg-spinners:ring-resize" className="w-4 h-4 mr-2" />
              {t("profiles.v3.content.loading")}
            </div>
          ) : (
            <div className="h-40" />
          )
        ) : visibleScreenshots.length === 0 ? (
          <EmptyStateV3
            icon="solar:gallery-bold-duotone"
            title={t("profiles.v3.screenshots.empty")}
            hint={t("profiles.v3.screenshots.emptyHint")}
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {visibleScreenshots.map((s) => (
              <ScreenshotTile
                key={s.path}
                screenshot={s}
                accentColor={accentColor.value}
                isSelected={selectedPaths.has(s.path)}
                selectMode={selectedPaths.size > 0}
                onToggleSelection={() => toggleSelection(s.path)}
                onOpen={() => setModalScreenshot(s)}
                onShare={() => shareScreenshot(s)}
                onDelete={() => confirmDelete([s.path])}
              />
            ))}
          </div>
        )}
      </div>

      <FloatingActionBar
        visible={selectedPaths.size > 0}
        count={selectedPaths.size}
        totalCount={visibleScreenshots.length}
        accent={accentColor.value}
        allSelected={allSelected}
        onSelectAll={selectAllUndo.onSelectAll}
        onRestore={selectAllUndo.onRestore}
        onClear={() => setSelectedPaths(new Set())}
        actions={fabActions}
        batchProgress={null}
      />

      <ProfileScreenshotModal
        isOpen={modalScreenshot !== null}
        onClose={() => setModalScreenshot(null)}
        screenshot={modalScreenshot}
        sharing={modalScreenshot ? isSharing(modalScreenshot.path) : false}
        onShare={() => modalScreenshot && shareScreenshot(modalScreenshot)}
        onDelete={() => modalScreenshot && confirmDelete([modalScreenshot.path])}
        onRename={renameScreenshot}
        position={modalIndex >= 0 ? { index: modalIndex, total: visibleScreenshots.length } : undefined}
        onNavigate={navigate}
      />

      {shareDialog}
    </div>
  );
}

// ─── Screenshot Tile ────────────────────────────────────────────────────────
interface ScreenshotTileProps {
  screenshot: ScreenshotInfo;
  accentColor: string;
  isSelected: boolean;
  selectMode: boolean;
  onToggleSelection: () => void;
  onOpen: () => void;
  onShare: () => void;
  onDelete: () => void;
}

const MENU_HEIGHT = 210;

const ScreenshotTile: React.FC<ScreenshotTileProps> = ({
  screenshot, accentColor, isSelected, selectMode, onToggleSelection, onOpen, onShare, onDelete,
}) => {
  const { t } = useTranslation();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const menuItems: ContextMenuItem<ScreenshotInfo>[] = [
    { id: "open", label: t("screenshots.view"), icon: "solar:eye-bold", onClick: onOpen },
    { id: "share", label: t("screenshots.share"), icon: "solar:cloud-upload-bold", onClick: onShare },
    { id: "copy", label: t("screenshots.copy_image"), icon: "solar:copy-bold", onClick: (s) => void copyScreenshotImage(s.path, t) },
    { id: "reveal", label: t("clips.gallery.reveal"), icon: "solar:folder-with-files-bold", onClick: (s) => void revealScreenshot(s.path, t) },
    { id: "delete", label: t("clips.gallery.delete"), icon: "solar:trash-bin-trash-bold", destructive: true, separator: true, onClick: onDelete },
  ];
  // Intersection-Observer: Preview wird erst angefordert wenn das Tile in
  // den Viewport kommt. Vermeidet initial 200+ parallele Backend-Calls.
  const { ref, inView } = useInView({ triggerOnce: true, rootMargin: "300px" });

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!inView || previewUrl || previewError) return;
    (async () => {
      try {
        const thumbnail = await getImageThumbnail(screenshot.path, THUMBNAIL_SIZE);
        if (!mountedRef.current) return;
        setPreviewUrl(convertFileSrc(thumbnail));
      } catch (err) {
        console.error("[V3 Screenshots] Preview failed:", err);
        if (mountedRef.current) setPreviewError(true);
      }
    })();
  }, [inView, screenshot.path, previewUrl, previewError]);

  return (
    <div
      ref={ref}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuAt(clampMenuPosition(e.clientX, e.clientY, MENU_HEIGHT));
      }}
      onClick={(e) => {
        // Klick in Select-Mode toggled Selection statt Modal zu oeffnen.
        if (selectMode) { e.stopPropagation(); onToggleSelection(); return; }
        onOpen();
      }}
      style={isSelected ? { borderColor: accentColor, boxShadow: `0 0 0 1px ${accentColor}` } : undefined}
      className={`group relative aspect-video rounded-md overflow-hidden bg-white/5 border transition-all cursor-pointer ${
        isSelected ? "" : "border-white/10 hover:border-white/30"
      }`}
    >
      {previewError ? (
        <div className="w-full h-full flex items-center justify-center text-white/25">
          <Icon icon="solar:gallery-remove-bold" className="w-6 h-6" />
        </div>
      ) : previewUrl ? (
        <img
          src={previewUrl}
          alt=""
          loading="lazy"
          onLoad={() => setIsLoaded(true)}
          className={`w-full h-full object-cover transition-opacity duration-300 ${isLoaded ? "opacity-100" : "opacity-0"}`}
          style={{ imageRendering: "auto" }}
        />
      ) : null}

      <div
        className={`absolute inset-0 pointer-events-none transition-opacity ${
          isSelected ? "bg-black/25" : "bg-gradient-to-b from-black/40 via-transparent to-black/60 opacity-0 group-hover:opacity-100"
        }`}
      />

      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute top-2 left-2 transition-opacity ${selectMode || isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        <CheckboxV2
          size="sm"
          checked={isSelected}
          onChange={onToggleSelection}
          tooltip={isSelected ? t("profiles.v3.tile.deselect") : t("profiles.v3.tile.select")}
        />
      </div>

      <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[10px] text-white font-minecraft bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded">
          {formatRelativeTime(screenshot.modified)}
        </span>
      </div>
      {menuAt && createPortal(
        <div onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
          <SettingsContextMenu
            target={screenshot}
            isOpen
            position={menuAt}
            items={menuItems}
            onClose={() => setMenuAt(null)}
            compact
          />
        </div>,
        document.body,
      )}
    </div>
  );
};
