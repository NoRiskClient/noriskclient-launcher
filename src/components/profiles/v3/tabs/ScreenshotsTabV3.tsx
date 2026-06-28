"use client";

/**
 * ScreenshotsTabV3 — Gallery-Grid mit Hover-Overlay + Fullscreen-Modal.
 * Ersetzt V2 ScreenshotsTab. Reused V2 ProfileScreenshotModal unveraendert.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { invoke } from "@tauri-apps/api/core";
import { useInView } from "react-intersection-observer";

import type { Profile } from "../../../../types/profile";
import type { ScreenshotInfo } from "../../../../types/profile";
import { getImagePreview } from "../../../../services/tauri-service";
import { useThemeStore } from "../../../../store/useThemeStore";
import { useDelayedTrue } from "../../../../hooks/useDelayedTrue";
import { formatRelativeTime } from "../../../../utils/format-relative-time";
import { ProfileScreenshotModal } from "../../ProfileScreenshotModal";
import { ConfirmDeleteDialog } from "../../../modals/ConfirmDeleteDialog";
import { useGlobalModal } from "../../../../hooks/useGlobalModal";
import { ThemedDropdown, ThemedDropdownItem } from "../shared/ThemedDropdown";
import { EmptyStateV3 } from "../shared/EmptyStateV3";
import { FloatingActionBar, type FABActionConfig } from "../shared/FloatingActionBar";
import { parseErrorMessage } from "../../../../utils/error-utils";

interface ScreenshotsTabV3Props {
  profile: Profile;
  isActive?: boolean;
}

type SortKey = "newest" | "oldest";

const SORT_OPTIONS: { value: SortKey; labelKey: string; icon: string }[] = [
  { value: "newest", labelKey: "profiles.v3.screenshots.sort.newest", icon: "solar:sort-from-top-to-bottom-bold" },
  { value: "oldest", labelKey: "profiles.v3.screenshots.sort.oldest", icon: "solar:sort-from-bottom-to-top-bold" },
];

// Preview-Groesse fuer die Grid-Thumbnails. Backend resized das Bild auf
// diese Dimensionen (mit JPEG-Quality) damit wir nicht fuer jedes Tile das
// volle Bild ausliefern.
const PREVIEW_WIDTH = 480;
const PREVIEW_HEIGHT = 270;
const PREVIEW_QUALITY = 75;

export function ScreenshotsTabV3({ profile, isActive = true }: ScreenshotsTabV3Props) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const { showModal, hideModal } = useGlobalModal();

  // ── Data ──────────────────────────────────────────────────────────────────
  const [screenshots, setScreenshots] = useState<ScreenshotInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
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
    const sorted = [...screenshots];
    const toTs = (s: ScreenshotInfo) => s.modified ? new Date(s.modified).getTime() : 0;
    if (sortBy === "newest")  sorted.sort((a, b) => toTs(b) - toTs(a));
    else                      sorted.sort((a, b) => toTs(a) - toTs(b));
    return sorted;
  }, [screenshots, sortBy]);

  const activeSortLabel = t(SORT_OPTIONS.find(o => o.value === sortBy)?.labelKey ?? "profiles.v3.screenshots.sort.newest");

  // ── Actions ───────────────────────────────────────────────────────────────
  const toggleSelection = (path: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const handleScreenshotDeleted = useCallback((deletedPath: string) => {
    setScreenshots(prev => prev.filter(s => s.path !== deletedPath));
    setSelectedPaths(prev => {
      if (!prev.has(deletedPath)) return prev;
      const next = new Set(prev);
      next.delete(deletedPath);
      return next;
    });
    setModalScreenshot(null);
  }, []);

  const handleBatchDelete = useCallback(() => {
    if (selectedPaths.size === 0) return;
    const paths = Array.from(selectedPaths);
    const modalId = "batch-delete-screenshots";
    const doDelete = async () => {
      setIsBatchDeleting(true);
      let successCount = 0;
      try {
        for (const p of paths) {
          try {
            await invoke("delete_file", { path: p });
            successCount++;
          } catch (err) {
            console.error("[V3 Screenshots] Delete failed for", p, err);
          }
        }
        toast.success(t("profiles.v3.screenshots.batchDeleteSuccess", { count: successCount }));
        setSelectedPaths(new Set());
        await loadData();
      } finally {
        setIsBatchDeleting(false);
        hideModal(modalId);
      }
    };
    showModal(modalId, (
      <ConfirmDeleteDialog
        isOpen={true}
        itemName={t("profiles.v3.screenshots.batchDeleteItemName", { count: paths.length })}
        onClose={() => hideModal(modalId)}
        onConfirm={doDelete}
        isDeleting={isBatchDeleting}
        title={t("profiles.v3.screenshots.batchDeleteTitle")}
        message={<p className="text-white/80 font-minecraft-ten">{t("profiles.v3.screenshots.batchDeleteConfirm", { count: paths.length })}</p>}
      />
    ));
  }, [selectedPaths, loadData, showModal, hideModal, isBatchDeleting, t]);

  // Esc clears selection
  useEffect(() => {
    if (selectedPaths.size === 0) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedPaths(new Set()); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedPaths.size]);

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

  return (
    <div className="flex flex-col min-h-0 flex-1 relative">
      {/* ── Sticky Toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-5 h-12 border-b border-white/5 flex-shrink-0 bg-black/20 sticky top-0 z-10">
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

        <span className="text-[10px] text-white/35 font-minecraft-ten tabular-nums">
          {t("profiles.v3.screenshots.count", { count: screenshots.length })}
        </span>

        <button
          onClick={loadData}
          disabled={loading}
          className="h-8 px-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white disabled:opacity-50 flex items-center transition-colors"
          title={t("profiles.v3.toolbar.refresh")}
        >
          <Icon icon="solar:refresh-bold" className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div className={`flex-1 min-h-0 overflow-y-auto p-5 ${selectedPaths.size > 0 ? "pb-24" : ""}`}>
        {error && (
          <div className="mb-4 flex items-start gap-3 p-3 rounded-lg border border-rose-400/30 bg-rose-500/10">
            <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-rose-300 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 text-xs font-minecraft-ten text-rose-100 break-words">{error}</div>
            <button
              onClick={loadData}
              className="flex-shrink-0 h-7 px-2 rounded-md text-[10px] font-minecraft-ten uppercase tracking-wider text-rose-100 hover:bg-rose-500/20 transition-colors"
            >
              {t("profiles.v3.content.retry")}
            </button>
          </div>
        )}

        {loading && screenshots.length === 0 ? (
          shouldShowLoading ? (
            <div className="flex items-center justify-center h-40 text-white/40 font-minecraft-ten text-sm animate-in fade-in duration-300">
              <Icon icon="solar:refresh-bold" className="w-4 h-4 mr-2 animate-spin" />
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
        allSelected={selectedPaths.size === visibleScreenshots.length && visibleScreenshots.length > 0}
        onSelectAll={() => setSelectedPaths(new Set(visibleScreenshots.map(s => s.path)))}
        onClear={() => setSelectedPaths(new Set())}
        actions={fabActions}
        batchProgress={null}
      />

      <ProfileScreenshotModal
        isOpen={modalScreenshot !== null}
        onClose={() => setModalScreenshot(null)}
        screenshot={modalScreenshot}
        onScreenshotDeleted={handleScreenshotDeleted}
      />
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
}

const ScreenshotTile: React.FC<ScreenshotTileProps> = ({
  screenshot, accentColor, isSelected, selectMode, onToggleSelection, onOpen,
}) => {
  const { t } = useTranslation();
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
        const res = await getImagePreview({
          path: screenshot.path,
          width: PREVIEW_WIDTH,
          height: PREVIEW_HEIGHT,
          quality: PREVIEW_QUALITY,
        });
        if (!mountedRef.current) return;
        setPreviewUrl(`data:image/jpeg;base64,${res.base64_image}`);
      } catch (err) {
        console.error("[V3 Screenshots] Preview failed:", err);
        if (mountedRef.current) setPreviewError(true);
      }
    })();
  }, [inView, screenshot.path, previewUrl, previewError]);

  return (
    <div
      ref={ref}
      onClick={(e) => {
        // Klick in Select-Mode toggled Selection statt Modal zu oeffnen.
        if (selectMode) { e.stopPropagation(); onToggleSelection(); return; }
        onOpen();
      }}
      style={isSelected ? { borderColor: `${accentColor}aa`, boxShadow: `0 0 0 1px ${accentColor}aa` } : undefined}
      className={`group relative aspect-video rounded-md overflow-hidden bg-white/5 border transition-all cursor-pointer ${
        isSelected ? "" : "border-white/10 hover:border-white/30"
      }`}
    >
      {/* Preview / Placeholder / Error */}
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
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/20">
          <Icon icon="solar:gallery-bold-duotone" className="w-7 h-7" />
        </div>
      )}

      {/* Hover overlay (dimmt Bild, zeigt Checkbox + Date) */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity ${
          isSelected ? "bg-black/25" : "bg-gradient-to-b from-black/40 via-transparent to-black/60 opacity-0 group-hover:opacity-100"
        }`}
      />

      {/* Selection-Checkbox: permanent sichtbar im Select-Mode oder bei Selected,
          sonst erst on-hover. Eigener pointer-events-auto damit Click nicht
          durch den Overlay blockiert wird. */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleSelection(); }}
        className={`absolute top-2 left-2 pointer-events-auto transition-opacity ${
          selectMode || isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
        title={isSelected ? t("profiles.v3.tile.deselect") : t("profiles.v3.tile.select")}
      >
        <div
          style={isSelected ? { backgroundColor: accentColor, borderColor: accentColor } : undefined}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            isSelected ? "" : "bg-black/50 border-white/60 hover:border-white"
          }`}
        >
          {isSelected && <Icon icon="solar:check-read-linear" className="w-3.5 h-3.5 text-black" />}
        </div>
      </button>

      {/* Date-Badge unten links — nur bei Hover sichtbar */}
      <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[10px] text-white font-minecraft-ten bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded">
          {formatRelativeTime(screenshot.modified)}
        </span>
      </div>
    </div>
  );
};
