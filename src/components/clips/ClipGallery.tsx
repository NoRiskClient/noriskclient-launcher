"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { convertFileSrc } from "@tauri-apps/api/core";

import { cn } from "../../lib/utils";
import { Button } from "../ui/buttons/Button";
import { EmptyState } from "../ui/EmptyState";
import { Modal } from "../ui/Modal";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { useThemeStore } from "../../store/useThemeStore";
import {
  deleteClip,
  getClipDetails,
  renameClip,
  setClipFavourite,
  getClipStorageUsage,
  listClips,
  revealClip,
  trimClip,
  type ClipDetails,
  type ClipEntry,
  type ClipStorageUsage,
  type TrackLevel,
} from "../../services/clip-service";
import { ClipTrimmer } from "./ClipTrimmer";
import { ClipIconButton } from "./ClipIconButton";
import { ClipThumbnail } from "./ClipThumbnail";
import { RenameClipModal } from "./RenameClipModal";
import { VerticalExport } from "./VerticalExport";
import { parseErrorMessage } from "../../utils/error-utils";

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
  const { t } = useTranslation();
  const { confirm, confirmDialog } = useConfirmDialog();

  const [clips, setClips] = useState<ClipEntry[] | null>(null);
  const [usage, setUsage] = useState<ClipStorageUsage | null>(null);
  const [selected, setSelected] = useState<ClipEntry | null>(null);
  const [vertical, setVertical] = useState<ClipEntry | null>(null);
  const [renaming, setRenaming] = useState<ClipEntry | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [entries, storage] = await Promise.all([listClips(), getClipStorageUsage()]);
      setClips(entries);
      setUsage(storage);
    } catch (e) {
      console.error("Could not read the clip folder", e);
      setClips([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const stops = await Promise.all([
        listen("clip_saved", () => void refresh()),
        listen("clip_trimmed", () => void refresh()),
        listen("clip_exported", () => void refresh()),
      ]);
      unlisten = () => stops.forEach((stop) => stop());
    })();
    return () => unlisten?.();
  }, [refresh]);

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

  if (clips === null || shown === null) {
    return (
      <p className="text-white/70 font-smallcaps text-sm text-center py-4">
        {t("clips.gallery.loading")}
      </p>
    );
  }

  if (clips.length === 0) {
    return (
      <EmptyState
        icon="solar:video-library-bold"
        message={t("clips.gallery.empty")}
        description={t("clips.gallery.empty_hint")}
        smallDescription
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {usage && (
        <StorageBar
          usage={usage}
          count={clips.length}
          shown={shown.length}
          filtered={shown.length !== clips.length}
          t={t}
        />
      )}

      {shown.length === 0 && (
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

      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {shown.map((clip, index) => (
          <ClipCard
            key={clip.path}
            clip={clip}
            index={index}
            busy={busy === clip.path}
            onPlay={() => setSelected(clip)}
            onReveal={() =>
              void revealClip(clip.path).catch((e) => toast.error(parseErrorMessage(e)))
            }
            onDelete={() => void remove(clip)}
            onFavourite={(favourite) => void setFavourite(clip, favourite)}
            onRename={() => setRenaming(clip)}
            onThumbnail={refresh}
            onVertical={() => setVertical(clip)}
            t={t}
          />
        ))}
      </div>

      {selected && (
        <ClipPlayer
          clip={selected}
          onClose={() => setSelected(null)}
          onVertical={() => setVertical(selected)}
          t={t}
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
  onDelete,
  onFavourite,
  onRename,
  onThumbnail,
  onVertical,
  t,
}: {
  clip: ClipEntry;
  index: number;
  busy: boolean;
  onPlay: () => void;
  onReveal: () => void;
  onDelete: () => void;
  onFavourite: (favourite: boolean) => void;
  onRename: () => void;
  onThumbnail: () => void;
  onVertical: () => void;
  t: Translate;
}) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const animated = useThemeStore((state) => state.isBackgroundAnimationEnabled);
  const [hovered, setHovered] = useState(false);

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

      <div className="absolute top-2 right-2 z-20 flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200">
        <ClipIconButton icon="solar:pen-bold" label={t("clips.gallery.rename")} onClick={onRename} />
        <ClipIconButton icon="solar:smartphone-bold" label={t("clips.gallery.vertical")} onClick={onVertical} />
        <ClipIconButton icon="solar:folder-with-files-bold" label={t("clips.gallery.reveal")} onClick={onReveal} />
        <ClipIconButton
          icon="solar:trash-bin-trash-bold"
          label={t("clips.gallery.delete")}
          tone="danger"
          onClick={onDelete}
        />
      </div>

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
          <span className="truncate">{formatWhen(clip.createdAt, t)}</span>
          <span className="w-px h-3 bg-white/30 shrink-0" />
          <span className="shrink-0 text-white/50">{formatBytes(clip.sizeBytes)}</span>
        </div>
      </div>
    </div>
  );
}

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
}: {
  clip: ClipEntry;
  onClose: () => void;
  onVertical: () => void;
  t: Translate;
}) {
  const src = useMemo(() => convertFileSrc(clip.path), [clip.path]);

  const [trimming, setTrimming] = useState(false);
  const [duration, setDuration] = useState(0);
  const [ratio, setRatio] = useState(16 / 9);
  const [saving, setSaving] = useState(false);
  const [details, setDetails] = useState<ClipDetails | null>(null);

  useEffect(() => {
    let current = true;
    setDetails(null);
    void getClipDetails(clip.path)
      .then((loaded) => {
        if (current) setDetails(loaded);
      })
      .catch((e) => {
        console.warn("Could not read the clip's details", e);
      });
    return () => {
      current = false;
    };
  }, [clip.path]);

  const save = useCallback(
    async (startSeconds: number, endSeconds: number, levels: TrackLevel[]) => {
      setSaving(true);
      try {
        await trimClip(clip.path, startSeconds, endSeconds, levels);
        toast.success(t("clips.trim.saved"));
        setTrimming(false);
      } catch (e) {
        console.error("Could not trim the clip", e);
        toast.error(t("clips.trim.failed"));
      } finally {
        setSaving(false);
      }
    },
    [clip.path, t],
  );

  const footer = trimming ? undefined : (
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
        onClick={() => setTrimming(true)}
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
          {formatWhen(clip.createdAt, t)} · {formatBytes(clip.sizeBytes)}
        </span>
      }
      onClose={onClose}
      width="xl"
      closeOnClickOutside={!trimming}
      footer={footer}
    >
      <div className="p-4">
        {trimming ? (
          <ClipTrimmer
            src={src}
            path={clip.path}
            duration={duration}
            busy={saving}
            details={details}
            onCancel={() => setTrimming(false)}
            onSave={save}
            t={t}
          />
        ) : (
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
        )}
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

function formatWhen(unixSeconds: number, t: Translate): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);

  if (seconds < 60) return t("clips.gallery.just_now");
  if (seconds < 3600) return t("clips.gallery.minutes_ago", { count: Math.floor(seconds / 60) });
  if (seconds < 86_400) return t("clips.gallery.hours_ago", { count: Math.floor(seconds / 3600) });

  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
