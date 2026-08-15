"use client";



import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { invoke } from "@tauri-apps/api/core";
import { useInView } from "react-intersection-observer";

import type { Profile } from "../../../../types/profile";
import type { ScreenshotInfo, ScreenshotGroup } from "../../../../types/profile";
import { getImagePreview } from "../../../../services/tauri-service";
import { useThemeStore } from "../../../../store/useThemeStore";
import { useDelayedTrue } from "../../../../hooks/useDelayedTrue";
import { formatRelativeTime } from "../../../../utils/format-relative-time";
import { ProfileScreenshotModal } from "../../ProfileScreenshotModal";
import { ConfirmDeleteDialog } from "../../../modals/ConfirmDeleteDialog";
import { useGlobalModal } from "../../../../hooks/useGlobalModal";
import { ThemedDropdown, ThemedDropdownItem } from "../shared/ThemedDropdown";
import { EmptyStateV3 as EmptyState } from "../shared/EmptyStateV3";
import { FloatingActionBar, type FABActionConfig } from "../shared/FloatingActionBar";
import { parseErrorMessage } from "../../../../utils/error-utils";

interface ScreenshotTabProps {
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

export function ScreenshotsTabV3({ profile, isActive = true }: ScreenshotTabProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const { showModal, hideModal } = useGlobalModal();

  const [screenshots, setScreenshots] = useState<ScreenshotInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [modalScreenshotGroup, setModalScreenshotGroup] = useState<ScreenshotGroup | null>(null);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

  // McReal Toggle
  const [showMcreals, setShowMcreals] = useState(false);

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

  const visibleGroups = useMemo(() => {
    const sorted = [...screenshots];
    const toTs = (s: ScreenshotInfo) => s.modified ? new Date(s.modified).getTime() : 0;
    if (sortBy === "newest") sorted.sort((a, b) => toTs(b) - toTs(a));
    else sorted.sort((a, b) => toTs(a) - toTs(b));

    const groups: ScreenshotGroup[] = [];
    const mcrealSecondaries = new Map<string, ScreenshotInfo>();

    // First pass: identify all secondary images
    for (const s of sorted) {
      if (s.filename.includes("_mcreal_secondary")) {
        const prefix = s.filename.split("_mcreal_secondary")[0];
        mcrealSecondaries.set(prefix, s);
      }
    }

    // Second pass: build groups
    for (const s of sorted) {
      if (s.filename.includes("_mcreal_secondary")) {
        // Skip, handled by primary
        continue;
      }
      if (s.filename.includes("_mcreal_primary")) {
        if (!showMcreals) continue;
        const prefix = s.filename.split("_mcreal_primary")[0];
        const secondary = mcrealSecondaries.get(prefix);
        if (secondary) {
          groups.push({ type: 'bereal', main: s, secondary: secondary });
        } else {
          groups.push({ type: 'single', main: s });
        }
      } else {
        if (showMcreals) continue;
        groups.push({ type: 'single', main: s });
      }
    }
    return groups;
  }, [screenshots, sortBy, showMcreals]);

  const activeSortLabel = t(SORT_OPTIONS.find(o => o.value === sortBy)?.labelKey ?? "profiles.v3.screenshots.sort.newest");

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
    setModalScreenshotGroup(null);
  }, []);

  const handleBatchDelete = useCallback(() => {
    if (selectedPaths.size === 0) return;
    
    // Find all files to delete (including secondaries if bereal)
    const filesToDelete = new Set<string>();
    for (const p of selectedPaths) {
      filesToDelete.add(p);
      const group = visibleGroups.find(g => g.main.path === p);
      if (group && group.secondary) {
        filesToDelete.add(group.secondary.path);
      }
    }
    
    const paths = Array.from(filesToDelete);
    const modalId = "batch-delete-screenshots";
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
        itemName={t("profiles.v3.screenshots.batchDeleteItemName", { count: selectedPaths.size })}
        onClose={() => hideModal(modalId)}
        onConfirm={doDelete}
        isDeleting={isBatchDeleting}
        title={t("profiles.v3.screenshots.batchDeleteTitle")}
        message={<p className="text-white/80 font-minecraft">{t("profiles.v3.screenshots.batchDeleteConfirm", { count: selectedPaths.size })}</p>}
      />
    ));
  }, [selectedPaths, visibleGroups, loadData, showModal, hideModal, isBatchDeleting, t]);

  // Esc clears selection, Space opens single selection
  useEffect(() => {
    if (selectedPaths.size === 0) return;
    const onKey = (e: KeyboardEvent) => { 
      if (e.key === "Escape") {
        setSelectedPaths(new Set()); 
      } else if (e.key === " " && selectedPaths.size === 1) {
        e.preventDefault();
        const selectedPath = Array.from(selectedPaths)[0];
        const group = visibleGroups.find(g => g.main.path === selectedPath);
        if (group) setModalScreenshotGroup(group);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedPaths, visibleGroups]);

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

  const modalIndex = modalScreenshotGroup ? visibleGroups.findIndex(g => g.main.path === modalScreenshotGroup.main.path) : -1;
  const onNext = modalIndex >= 0 && modalIndex < visibleGroups.length - 1 ? () => setModalScreenshotGroup(visibleGroups[modalIndex + 1]) : undefined;
  const onPrev = modalIndex > 0 ? () => setModalScreenshotGroup(visibleGroups[modalIndex - 1]) : undefined;

  const handleOpenFolder = () => {
    if (screenshots.length > 0) {
      // Prevent opening the mcreal subdirectory if a normal screenshot exists
      const rootScreenshot = screenshots.find(s => !s.path.toLowerCase().includes('mcreal'));
      if (rootScreenshot) {
        invoke("open_file_directory", { filePath: rootScreenshot.path }).catch(console.error);
      } else {
        const mcrealPath = screenshots[0].path;
        const mcrealIndex = mcrealPath.toLowerCase().lastIndexOf('mcreal');
        const parentDir = mcrealPath.substring(0, mcrealIndex - 1);
        invoke("open_file_directory", { filePath: parentDir }).catch(console.error);
      }
    } else if (profile?.id) {
      invoke("open_profile_folder", { profileId: profile.id }).catch(console.error);
    }
  };

  return (
    <div className="flex flex-col min-h-0 flex-1 relative">
      {/* ── Sticky Toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-5 h-12 border-b border-white/5 flex-shrink-0 bg-black/20 sticky top-0 z-10">
        <div className="relative">
          <button
            onClick={() => setSortMenuOpen(v => !v)}
            className="h-8 px-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-minecraft text-white/70 flex items-center gap-1.5"
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

        {/* McReal Toggle */}
        <button
          onClick={() => setShowMcreals(!showMcreals)}
          className={`h-8 px-3 rounded-md border text-[10px] font-minecraft flex items-center gap-1.5 transition-colors ${showMcreals
              ? "bg-white/10 border-white/20 text-white"
              : "bg-black/20 border-white/5 text-white/50"
            }`}
          title={showMcreals ? "Hide McReals" : "Show McReals"}
        >
          <Icon icon={showMcreals ? "solar:eye-bold" : "solar:eye-closed-bold"} className="w-3.5 h-3.5" />
          McReals
        </button>

        <div className="flex-1" />

        <span className="text-[10px] text-white/35 font-minecraft tabular-nums">
          {t("profiles.v3.screenshots.count", { count: screenshots.length })}
        </span>

        <button
          onClick={handleOpenFolder}
          className="h-8 px-2.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white flex items-center transition-colors"
          title={t("logs.open_folder")}
        >
          <Icon icon="solar:folder-open-bold" className="w-4 h-4" />
        </button>

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
      <div className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2 -m-2 ${selectedPaths.size > 0 ? "pb-24" : ""}`}>
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
        ) : visibleGroups.length === 0 ? (
          <EmptyState
            icon="solar:gallery-bold-duotone"
            title={t("profiles.v3.screenshots.empty")}
            hint={t("profiles.v3.screenshots.emptyHint")}
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pb-24 pt-2">
            {visibleGroups.map((g) => (
              <ScreenshotTile
                key={g.main.path}
                group={g}
                accentColor={accentColor.value}
                isSelected={selectedPaths.has(g.main.path)}
                selectMode={selectedPaths.size > 0}
                onToggleSelection={() => {
                  toggleSelection(g.main.path);
                  if (g.secondary) {
                    // Optional: Toggle both, but for now we'll just track the main path to determine tile selection
                  }
                }}
                onOpen={() => setModalScreenshotGroup(g)}
              />
            ))}
          </div>
        )}
      </div>

      <FloatingActionBar
        visible={selectedPaths.size > 0}
        count={selectedPaths.size}
        totalCount={visibleGroups.length}
        accent={accentColor.value}
        allSelected={selectedPaths.size === visibleGroups.length && visibleGroups.length > 0}
        onSelectAll={() => setSelectedPaths(new Set(visibleGroups.map(g => g.main.path)))}
        onClear={() => setSelectedPaths(new Set())}
        actions={fabActions}
        batchProgress={null}
      />

      <ProfileScreenshotModal
        isOpen={modalScreenshotGroup !== null}
        onClose={() => setModalScreenshotGroup(null)}
        group={modalScreenshotGroup}
        onScreenshotDeleted={handleScreenshotDeleted}
        onNext={onNext}
        onPrev={onPrev}
      />
    </div>
  );
}

interface ScreenshotTileProps {
  group: ScreenshotGroup;
  accentColor: string;
  isSelected: boolean;
  selectMode: boolean;
  onToggleSelection: () => void;
  onOpen: () => void;
}

const isVideo = (path: string) => {
  const ext = path.toLowerCase();
  return ext.endsWith('.mp4') || ext.endsWith('.webm') || ext.endsWith('.mov');
};

const ScreenshotTile: React.FC<ScreenshotTileProps> = ({
  group, accentColor, isSelected, selectMode, onToggleSelection, onOpen,
}) => {
  const { t } = useTranslation();
  const { ref, inView } = useInView({ triggerOnce: true, rootMargin: "300px" });

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // BeReal State
  const [swapped, setSwapped] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const currentMainInfo = swapped && group.secondary ? group.secondary : group.main;
  const currentSecInfo = swapped ? group.main : group.secondary;
  const currentIsVideo = isVideo(currentMainInfo.path);

  useEffect(() => {
    if (!inView || previewUrl || previewError) return;
    if (currentIsVideo) {
      import('@tauri-apps/api/core').then(({ convertFileSrc }) => {
        if (!mountedRef.current) return;
        setPreviewUrl(convertFileSrc(currentMainInfo.path));
      });
      return;
    }
    (async () => {
      try {
        const res = await getImagePreview({
          path: currentMainInfo.path,
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
  }, [inView, currentMainInfo.path, previewUrl, previewError, currentIsVideo]);

  return (
    <div
      ref={ref}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          if (selectMode) { onToggleSelection(); return; }
          onOpen();
        }
      }}
      onClick={(e) => {
        // Klick in Select-Mode toggled Selection statt Modal zu oeffnen.
        if (selectMode) { e.stopPropagation(); onToggleSelection(); return; }
        onOpen();
      }}
      style={isSelected ? { borderColor: `${accentColor}aa`, boxShadow: `0 0 0 1px ${accentColor}aa` } : undefined}
      className={`group relative aspect-video rounded-md overflow-hidden bg-white/5 border transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/50 ${isSelected ? "" : "border-white/10 hover:border-white/30"
        }`}
    >
      {/* Preview / Placeholder / Error */}
      {previewError ? (
        <div className="w-full h-full flex items-center justify-center text-white/25">
          <Icon icon="solar:gallery-remove-bold" className="w-6 h-6" />
        </div>
      ) : previewUrl ? (
        currentIsVideo ? (
          <video
            src={previewUrl}
            onLoadedData={() => setIsLoaded(true)}
            className={`w-full h-full object-cover transition-opacity duration-300 ${isLoaded ? "opacity-100" : "opacity-0"}`}
            muted
            loop
            onMouseEnter={(e) => { e.currentTarget.play().catch(() => { }); }}
            onMouseLeave={(e) => { e.currentTarget.pause(); }}
          />
        ) : (
          <img
            src={previewUrl}
            alt=""
            loading="lazy"
            onLoad={() => setIsLoaded(true)}
            className={`w-full h-full object-cover transition-opacity duration-300 ${isLoaded ? "opacity-100" : "opacity-0"}`}
            style={{ imageRendering: "auto" }}
          />
        )
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/20">
          <Icon icon="solar:gallery-bold-duotone" className="w-7 h-7" />
        </div>
      )}

      {/* Video Indicator */}
      {currentIsVideo && (
        <div className="absolute top-2 right-2 bg-black/60 rounded p-1 text-white/90">
          <Icon icon="solar:play-circle-bold" className="w-4 h-4" />
        </div>
      )}

      {/* BeReal Secondary Image */}
      {group.type === 'bereal' && currentSecInfo && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            setSwapped(!swapped);
            setPreviewUrl(null); // Force reload of main preview
            setIsLoaded(false);
          }}
          className="absolute top-2 right-2 w-[22%] aspect-video rounded-sm overflow-hidden border-2 border-black/70 shadow-lg cursor-pointer z-20 hover:scale-105 transition-transform bg-black"
          title="Swap"
        >
          {isVideo(currentSecInfo.path) ? (
            <div className="w-full h-full flex items-center justify-center text-white/50 bg-zinc-900"><Icon icon="solar:video-frame-play-horizontal-bold" /></div>
          ) : (
            <BeRealSecondaryImage path={currentSecInfo.path} inView={inView} />
          )}
        </div>
      )}

      {/* Hover overlay (dimmt Bild, zeigt Checkbox + Date) */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity ${isSelected ? "bg-black/25" : "bg-gradient-to-b from-black/40 via-transparent to-black/60 opacity-0 group-hover:opacity-100"
          }`}
      />

      {/* Selection-Checkbox: permanent sichtbar im Select-Mode oder bei Selected,
          sonst erst on-hover. Eigener pointer-events-auto damit Click nicht
          durch den Overlay blockiert wird. */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleSelection(); }}
        className={`absolute top-2 left-2 pointer-events-auto transition-opacity ${selectMode || isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        title={isSelected ? t("profiles.v3.tile.deselect") : t("profiles.v3.tile.select")}
      >
        <div
          style={isSelected ? { backgroundColor: accentColor, borderColor: accentColor } : undefined}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isSelected ? "" : "bg-black/50 border-white/60 hover:border-white"
            }`}
        >
          {isSelected && <Icon icon="mdi:check-bold" className="w-3.5 h-3.5 text-black" />}
        </div>
      </button>

      {/* Date-Badge unten links — nur bei Hover sichtbar */}
      <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[10px] text-white font-minecraft bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded">
          {formatRelativeTime(currentMainInfo.modified)}
        </span>
      </div>
    </div>
  );
};

// Small component to handle the BeReal secondary image loading
const BeRealSecondaryImage = ({ path, inView }: { path: string, inView: boolean }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!inView) return;
    let active = true;
    getImagePreview({ path, width: 120, height: 160, quality: 60 })
      .then(res => {
        if (active) setUrl(`data:image/jpeg;base64,${res.base64_image}`);
      })
      .catch(() => { });
    return () => { active = false; };
  }, [path, inView]);

  if (!url) return <div className="w-full h-full bg-zinc-800 animate-pulse" />;
  return <img src={url} className="w-full h-full object-cover" alt="" />;
};
