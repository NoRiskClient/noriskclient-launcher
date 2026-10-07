"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { convertFileSrc } from "@tauri-apps/api/core";

import { cn } from "../../lib/utils";
import { Button } from "../ui/buttons/Button";
import { EmptyState } from "../ui/EmptyState";
import { ErrorMessage } from "../ui/ErrorMessage";
import { Modal } from "../ui/Modal";
import { SettingsContextMenu, type ContextMenuItem } from "../ui/SettingsContextMenu";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useThemeStore } from "../../store/useThemeStore";
import {
  deleteClip,
  exportGif,
  renameClip,
  setClipFavourite,
  getClipStorageUsage,
  listClips,
  openClipEditor,
  revealClip,
  samePath,
  type ClipEntry,
  type ClipStorageUsage,
} from "../../services/clip-service";
import { ClipIconButton } from "./ClipIconButton";
import { ClipThumbnail } from "./ClipThumbnail";
import { RenameClipModal } from "./RenameClipModal";
import { VerticalExport } from "./VerticalExport";
import { useClipEngineEvents } from "./useClipEngineEvents";
import { parseErrorMessage } from "../../utils/error-utils";
import { trackEvent } from "../../services/analytics-service";
import { isMacOS } from "../../utils/platform";

export type ClipSort = "newest" | "oldest" | "largest";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface ClipGalleryProps {
  search?: string;
  sort?: ClipSort;
  favouritesOnly?: boolean;
  game?: string | null;
  onGamesChange?: (games: string[]) => void;
}

export function ClipGallery({
  search = "",
  sort = "newest",
  favouritesOnly = false,
  game = null,
  onGamesChange,
}: ClipGalleryProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = resolveDateLocale(i18n.resolvedLanguage || i18n.language);
  const { confirm, confirmDialog } = useConfirmDialog();

  const [clips, setClips] = useState<ClipEntry[] | null>(null);
  const [usage, setUsage] = useState<ClipStorageUsage | null>(null);
  const [selected, setSelected] = useState<ClipEntry | null>(null);
  const [vertical, setVertical] = useState<ClipEntry | null>(null);
  const [renaming, setRenaming] = useState<ClipEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [gifting, setGifting] = useState<string[]>([]);
  const gifs = useRef(new Set<string>());
  const [readError, setReadError] = useState(false);
  const [usageError, setUsageError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const readGeneration = useRef(0);
  const mounted = useRef(true);
  const retryBusy = useRef(false);

  const refresh = useCallback(async () => {
    if (!mounted.current) return [];
    const generation = ++readGeneration.current;
    setRefreshing(true);
    try {
      const [list, storage] = await Promise.allSettled([listClips(), getClipStorageUsage()]);
      if (!mounted.current) return [];
      const listValid = list.status === 'fulfilled' && Array.isArray(list.value);
      const usageValid = storage.status === 'fulfilled' && storage.value != null &&
        [storage.value.usedBytes, storage.value.limitBytes, storage.value.clipCount].every((value) => Number.isFinite(value) && value >= 0);
      if (generation === readGeneration.current) {
        setReadError(!listValid);
        setUsageError(!usageValid);
        if (listValid) setClips(list.value);
        if (usageValid) setUsage(storage.value);
        if (!listValid) console.error("Could not read the clip folder", list.status === 'rejected' ? list.reason : 'Invalid clip list response');
        if (!usageValid) console.error("Could not read clip storage usage", storage.status === 'rejected' ? storage.reason : 'Invalid clip storage response');
      }
      // Preserve event/follow's real successful list result even when a newer
      // read owns presentation. Never manufacture fresh entries on a failure.
      return listValid ? list.value : [];
    } finally {
      if (mounted.current && generation === readGeneration.current) setRefreshing(false);
    }
  }, []);

  const retry = useCallback(async () => {
    if (!mounted.current || retryBusy.current) return;
    retryBusy.current = true;
    setRetrying(true);
    try { await refresh(); }
    finally {
      retryBusy.current = false;
      if (mounted.current) setRetrying(false);
    }
  }, [refresh]);

  const follow = useCallback(
    async (made: { path: string; source: string }) => {
      const fresh = (await refresh()).find((entry) => samePath(entry.path, made.path));
      if (!fresh) return;
      setSelected((current) => (current && samePath(current.path, made.source) ? fresh : current));
    },
    [refresh],
  );

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; readGeneration.current += 1; retryBusy.current = false; };
  }, [refresh]);

  const games = useMemo(() => {
    const seen = new Set<string>();
    for (const clip of clips ?? []) {
      if (clip.game) seen.add(clip.game);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [clips]);

  useEffect(() => {
    onGamesChange?.(games);
  }, [games, onGamesChange]);

  const gifDone = useCallback((source: string | null) => {
    for (const path of gifs.current) {
      if (source === null || samePath(path, source)) gifs.current.delete(path);
    }
    setGifting([...gifs.current]);
  }, []);

  useClipEngineEvents({
    clip_saved: () => void refresh(),
    clip_trimmed: (clip) => void follow(clip),
    clip_exported: (clip) => void follow(clip),
    clip_gif_exported: (gif) => {
      if (![...gifs.current].some((path) => samePath(path, gif.source))) return;
      gifDone(gif.source);
      toast.success(
        gif.truncated ? t("clips.gallery.gif_done_shortened") : t("clips.gallery.gif_done"),
      );
    },
    clip_error: (error) => {
      if (error.code !== "clip_write" && error.code !== "protocol") return;
      gifDone(error.source ?? null);
    },
    clip_engine_stopped: () => gifDone(null),
  });

  const makeGif = useCallback(
    async (clip: ClipEntry) => {
      gifs.current.add(clip.path);
      setGifting([...gifs.current]);
      try {
        await exportGif(clip.path);
      } catch (e) {
        gifDone(clip.path);
        console.error("Could not start the GIF export", e);
        toast.error(parseErrorMessage(e));
      }
    },
    [gifDone],
  );

  const setFavourite = useCallback(
    async (clip: ClipEntry, favourite: boolean) => {
      setClips((current) =>
        current?.map((entry) =>
          entry.path === clip.path ? { ...entry, favourite } : entry,
        ) ?? current,
      );
      try {
        await setClipFavourite(clip.path, favourite);
      } catch (e) {
        console.error("Could not mark the clip", e);
        toast.error(t("clips.gallery.favourite_failed"));
      }
      await refresh();
    },
    [refresh, t],
  );

  const rename = useCallback(
    async (clip: ClipEntry, wanted: string): Promise<boolean> => {
      try {
        const moved = await renameClip(clip.path, wanted);
        setSelected((current) =>
          current?.path === clip.path ? { ...current, path: moved, name: wanted } : current,
        );
        await refresh();
        return true;
      } catch (e) {
        console.error("Could not rename the clip", e);
        toast.error(parseErrorMessage(e));
        return false;
      }
    },
    [refresh],
  );

  const edit = useCallback((clip: ClipEntry) => {
    openClipEditor(clip.path, clip.name).catch((e) => {
      console.error("Could not open the clip editor", e);
      toast.error(parseErrorMessage(e));
    });
  }, []);

  const remove = useCallback(
    async (clip: ClipEntry) => {
      const sure = await confirm({
        title: t("clips.gallery.delete"),
        message: t("clips.gallery.delete_message", { name: clip.name }),
        confirmText: t("clips.gallery.delete_confirm"),
        cancelText: t("clips.gallery.cancel"),
        type: "danger",
      });
      if (!sure) return;

      setBusy(clip.path);
      try {
        await deleteClip(clip.path);
        setSelected((current) => (current?.path === clip.path ? null : current));
        await refresh();
      } catch (e) {
        toast.error(t("clips.gallery.delete_failed"));
        console.error("Could not delete the clip", e);
      } finally {
        setBusy(null);
      }
    },
    [confirm, refresh, t],
  );

  const shown = useMemo(() => {
    if (clips === null) return null;

    const needle = search.trim().toLowerCase();
    const matching = clips.filter((clip) => {
      if (favouritesOnly && !clip.favourite) return false;
      if (game && clip.game !== game) return false;
      return !needle || clip.name.toLowerCase().includes(needle);
    });

    return [...matching].sort((a, b) => {
      switch (sort) {
        case "oldest":
          return a.createdAt - b.createdAt;
        case "largest":
          return b.sizeBytes - a.sizeBytes;
        default:
          return b.createdAt - a.createdAt;
      }
    });
  }, [clips, search, sort, favouritesOnly, game]);

  const months = useMemo(() => {
    if (shown === null) return null;
    if (sort === "largest") return [{ key: "all", label: null, clips: shown }];

    const out: { key: string; label: string | null; clips: ClipEntry[] }[] = [];
    for (const clip of shown) {
      const when = new Date(clip.createdAt * 1000);
      const key = `${when.getFullYear()}-${when.getMonth()}`;
      const open = out[out.length - 1];
      if (open && open.key === key) {
        open.clips.push(clip);
      } else {
        out.push({
          key,
          label: when.toLocaleDateString(dateLocale, { month: "long", year: "numeric" }),
          clips: [clip],
        });
      }
    }
    return out;
  }, [shown, sort, dateLocale]);

  const feedback = (readError || usageError) && (
    <div className="flex flex-col gap-3">
      {readError && <ErrorMessage message={t('clips.gallery.load_failed')} />}
      {readError && clips !== null && clips.length > 0 && <p className="font-minecraft text-sm text-white/70">{t('clips.gallery.previous_clips')}</p>}
      {usageError && <ErrorMessage message={t('clips.gallery.storage_load_failed')} />}
      {usageError && usage && <p className="font-minecraft text-sm text-white/70">{t('clips.gallery.previous_storage')}</p>}
      {(refreshing || retrying) && <p role="status" className="font-smallcaps text-sm text-white/70">{t('clips.gallery.loading')}</p>}
      <div><Button onClick={retry} variant="flat-secondary" size="sm" disabled={refreshing || retrying} aria-busy={refreshing || retrying || undefined}>{t('common.try_again')}</Button></div>
    </div>
  );

  if (clips === null || shown === null || months === null) {
    return (
      <div className="flex flex-col gap-4">
        {feedback}
        {!readError && <p role="status" className="text-white/70 font-smallcaps text-sm text-center py-4">
        {t("clips.gallery.loading")}
        </p>}
      </div>
    );
  }

  if (clips.length === 0 && !readError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {feedback}
      <EmptyState
        icon="solar:video-library-bold"
        message={t("clips.gallery.empty")}
        description={t("clips.gallery.empty_hint")}
        smallDescription
      />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {feedback}
      {usage && (
        <StorageBar
          usage={usage}
          count={clips.length}
          shown={shown.length}
          filtered={shown.length !== clips.length}
          t={t}
        />
      )}

      {clips.length > 0 && shown.length === 0 && (
        <EmptyState
          icon={search.trim() ? "solar:magnifer-bold" : "solar:star-bold"}
          message={
            search.trim()
              ? t("clips.gallery.no_match", { search: search.trim() })
              : t("clips.gallery.no_favourites")
          }
          description={search.trim() ? undefined : t("clips.gallery.no_favourites_hint")}
          smallDescription
          compact
          fullHeight={false}
        />
      )}

      {months.map((month) => (
        <div key={month.key} className="flex flex-col gap-3">
          {month.label && (
            <div className="flex items-baseline gap-2 border-b border-white/10 pb-1.5">
              <h3 className="font-minecraft text-base text-white/80 normal-case">
                {month.label}
              </h3>
              <span className="font-minecraft text-xs text-white/40">
                {month.clips.length}
              </span>
            </div>
          )}

          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {month.clips.map((clip, index) => (
              <ClipCard
                key={clip.path}
                clip={clip}
                index={index}
                busy={busy === clip.path || gifting.includes(clip.path)}
                onPlay={() => {
                  setSelected(clip);
                  void trackEvent("clip_played", { duration_s: clip.durationSeconds });
                }}
                onReveal={() =>
                  void revealClip(clip.path).catch((e) => toast.error(parseErrorMessage(e)))
                }
                onEdit={() => edit(clip)}
                onDelete={() => void remove(clip)}
                onFavourite={(favourite) => void setFavourite(clip, favourite)}
                onRename={() => setRenaming(clip)}
                onThumbnail={refresh}
                onVertical={() => setVertical(clip)}
                onGif={() => void makeGif(clip)}
                t={t}
                dateLocale={dateLocale}
              />
            ))}
          </div>
        </div>
      ))}

      {selected && (
        <ClipPlayer
          key={selected.path}
          clip={selected}
          onClose={() => setSelected(null)}
          onVertical={() => setVertical(selected)}
          t={t}
          dateLocale={dateLocale}
        />
      )}

      {renaming && (
        <RenameClipModal
          key={renaming.path}
          currentName={renaming.name}
          onClose={() => setRenaming(null)}
          onConfirm={(name) => rename(renaming, name)}
        />
      )}

      {vertical && (
        <VerticalExport
          src={convertFileSrc(vertical.path)}
          path={vertical.path}
          onClose={() => setVertical(null)}
          onDone={() => {
            setVertical(null);
            void refresh();
          }}
          t={t}
        />
      )}

      {confirmDialog}
    </div>
  );
}

function ClipCard({
  clip,
  index,
  busy,
  onPlay,
  onReveal,
  onEdit,
  onDelete,
  onFavourite,
  onRename,
  onThumbnail,
  onVertical,
  onGif,
  t,
  dateLocale,
}: {
  clip: ClipEntry;
  index: number;
  busy: boolean;
  onPlay: () => void;
  onReveal: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onFavourite: (favourite: boolean) => void;
  onRename: () => void;
  onThumbnail: () => void;
  onVertical: () => void;
  onGif: () => void;
  t: Translate;
  dateLocale: string;
}) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const animated = useThemeStore((state) => state.isBackgroundAnimationEnabled);
  const [hovered, setHovered] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  const openMenu = (x: number, y: number) =>
    setMenuAt({
      x: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT - 8)),
    });

  const menuItems: ContextMenuItem<ClipEntry>[] = [
    { id: "edit", label: t("clips.gallery.edit"), icon: "solar:scissors-bold", onClick: onEdit },
    { id: "rename", label: t("clips.gallery.rename"), icon: "solar:pen-bold", onClick: onRename },
    { id: "vertical", label: t("clips.gallery.vertical"), icon: "solar:smartphone-bold", onClick: onVertical },
    ...(isMacOS()
      ? []
      : [{ id: "gif", label: t("clips.gallery.gif"), icon: "solar:gallery-bold", onClick: onGif }]),
    { id: "reveal", label: t("clips.gallery.reveal"), icon: "solar:folder-with-files-bold", onClick: onReveal },
    {
      id: "delete",
      label: t("clips.gallery.delete"),
      icon: "solar:trash-bin-trash-bold",
      destructive: true,
      separator: true,
      onClick: onDelete,
    },
  ];

  const favouriteLabel = clip.favourite
    ? t("clips.gallery.unfavourite")
    : t("clips.gallery.favourite");

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg bg-black/20 border border-white/10 hover:border-white/20 transition-all duration-200",
        animated && "animate-in fade-in duration-500 fill-mode-both",
        busy && "pointer-events-none",
      )}
      style={{
        animationDelay: animated ? `${Math.min(index, 24) * 0.04}s` : undefined,
        backgroundColor: hovered ? `${accentColor.value}20` : undefined,
        borderColor: hovered ? `${accentColor.value}60` : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu(event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        onClick={onPlay}
        className="relative block w-full focus:outline-none"
        aria-label={t("clips.gallery.play")}
      >
        <ClipThumbnail clip={clip} onStored={onThumbnail} />
        <span className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <Icon icon="solar:play-bold" className="w-12 h-12 text-white" />
        </span>
        {clip.durationSeconds !== null && (
          <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 border border-white/10 px-1.5 py-0.5 font-minecraft text-xs text-white/80">
            {formatLength(clip.durationSeconds)}
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <Icon
              icon="svg-spinners:ring-resize"
              className="w-8 h-8"
              style={{ color: accentColor.value }}
            />
          </span>
        )}
      </button>

      <div className="absolute top-2 left-2 z-20">
        <ClipIconButton
          icon={clip.favourite ? "solar:star-bold" : "solar:star-linear"}
          label={favouriteLabel}
          aria-pressed={clip.favourite}
          onClick={() => onFavourite(!clip.favourite)}
          className={
            clip.favourite
              ? "text-yellow-400 hover:text-yellow-300"
              : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
          }
        />
      </div>

      <div
        ref={moreRef}
        className={cn(
          "absolute top-2 right-2 z-20 transition-opacity duration-200",
          menuAt ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        <ClipIconButton
          icon="solar:menu-dots-bold"
          label={t("content.actions.more")}
          withTooltip={false}
          onClick={() => {
            if (menuAt) {
              setMenuAt(null);
              return;
            }
            const box = moreRef.current?.getBoundingClientRect();
            if (box) openMenu(box.right - MENU_WIDTH, box.bottom + 4);
          }}
        />
      </div>

      {menuAt &&
        createPortal(
          <SettingsContextMenu
            target={clip}
            isOpen
            position={menuAt}
            items={menuItems}
            onClose={() => setMenuAt(null)}
            triggerButtonRef={moreRef}
            compact
          />,
          document.body,
        )}

      <div className="flex flex-col gap-1 px-3 py-2.5 min-w-0">
        <span className="font-minecraft text-base text-white whitespace-nowrap overflow-hidden text-ellipsis normal-case">
          {clip.name}
        </span>
        <div className="flex items-center gap-2 text-xs font-minecraft text-white/60 min-w-0">
          {clip.game && (
            <>
              <span className="truncate">{clip.game}</span>
              <span className="w-px h-3 bg-white/30 shrink-0" />
            </>
          )}
          <span className="truncate">{formatWhen(clip.createdAt, t, dateLocale)}</span>
          <span className="w-px h-3 bg-white/30 shrink-0" />
          <span className="shrink-0 text-white/50">{formatBytes(clip.sizeBytes)}</span>
        </div>
      </div>
    </div>
  );
}

const MENU_WIDTH = 176;
const MENU_HEIGHT = 220;

function formatLength(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

function ClipPlayer({
  clip,
  onClose,
  onVertical,
  t,
  dateLocale,
}: {
  clip: ClipEntry;
  onClose: () => void;
  onVertical: () => void;
  t: Translate;
  dateLocale: string;
}) {
  const src = useMemo(() => convertFileSrc(clip.path), [clip.path]);

  const [duration, setDuration] = useState(0);
  const [ratio, setRatio] = useState(16 / 9);

  const edit = useCallback(() => {
    openClipEditor(clip.path, clip.name).catch((e) => {
      console.error("Could not open the clip editor", e);
      toast.error(parseErrorMessage(e));
    });
  }, [clip.name, clip.path]);

  const footer = (
    <div className="flex items-center justify-end gap-3">
      <Button
        variant="secondary"
        size="sm"
        icon={<Icon icon="solar:smartphone-bold" className="w-4 h-4" />}
        onClick={onVertical}
      >
        {t("clips.vertical.open")}
      </Button>
      <Button
        variant="default"
        size="sm"
        icon={<Icon icon="solar:scissors-bold" className="w-4 h-4" />}
        onClick={edit}
        disabled={duration <= 0}
      >
        {t("clips.trim.open")}
      </Button>
    </div>
  );

  return (
    <Modal
      title={clip.name}
      titleIcon={<Icon icon="solar:videocamera-record-bold" className="w-5 h-5" />}
      titleSubtitle={
        <span className="font-minecraft text-xs text-white/60">
          {formatWhen(clip.createdAt, t, dateLocale)} · {formatBytes(clip.sizeBytes)}
        </span>
      }
      onClose={onClose}
      width="xl"
      footer={footer}
    >
      <div className="p-4">
        <div
          className="mx-auto w-full max-h-[calc(90vh-14rem)] overflow-hidden rounded-lg border border-white/10 bg-black"
          style={{
            aspectRatio: `${ratio}`,
            maxWidth: `calc((90vh - 14rem) * ${ratio})`,
          }}
        >
          <video
            src={src}
            controls
            autoPlay
            playsInline
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              setDuration(video.duration);
              if (video.videoWidth > 0 && video.videoHeight > 0) {
                setRatio(video.videoWidth / video.videoHeight);
              }
            }}
            className="block h-full w-full object-contain"
          />
        </div>
      </div>
    </Modal>
  );
}

function StorageBar({
  usage,
  count,
  shown,
  filtered,
  t,
}: {
  usage: ClipStorageUsage;
  count: number;
  shown: number;
  filtered: boolean;
  t: Translate;
}) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const unlimited = usage.limitBytes === 0;
  const ratio = unlimited ? 0 : Math.min(1, usage.usedBytes / usage.limitBytes);
  const crowded = ratio > 0.9;

  return (
    <div className="flex items-center gap-4 px-1">
      <span className="font-smallcaps text-base text-white/70 whitespace-nowrap">
        {filtered
          ? t("clips.gallery.count_filtered", { shown, count })
          : t("clips.gallery.count", { count })}
      </span>
      {!unlimited && (
        <div className="flex-1 h-1.5 rounded-full bg-black/40 border border-white/10 overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-300", crowded && "bg-yellow-400")}
            style={{
              width: `${Math.max(2, ratio * 100)}%`,
              backgroundColor: crowded ? undefined : accentColor.value,
            }}
          />
        </div>
      )}
      <span
        className={cn(
          "font-minecraft text-xs whitespace-nowrap",
          crowded ? "text-yellow-400" : "text-white/60",
          unlimited && "ml-auto",
        )}
      >
        {unlimited
          ? formatBytes(usage.usedBytes)
          : `${formatBytes(usage.usedBytes)} / ${formatBytes(usage.limitBytes)}`}
      </span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function resolveDateLocale(language: string | undefined): string {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(language || 'en')[0] || 'en';
  } catch {
    return 'en';
  }
}

function formatWhen(unixSeconds: number, t: Translate, dateLocale: string): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);

  if (seconds < 60) return t("clips.gallery.just_now");
  if (seconds < 3600) return t("clips.gallery.minutes_ago", { count: Math.floor(seconds / 60) });
  if (seconds < 86_400) return t("clips.gallery.hours_ago", { count: Math.floor(seconds / 3600) });

  return new Date(unixSeconds * 1000).toLocaleString(dateLocale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
