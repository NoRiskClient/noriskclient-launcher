"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { convertFileSrc } from "@tauri-apps/api/core";

import { cn } from "../../lib/utils";
import {
  deleteClip,
  getClipDetails,
  exportVertical,
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
import { ClipThumbnail } from "./ClipThumbnail";
import { VerticalExport } from "./VerticalExport";
import { parseErrorMessage } from "../../utils/error-utils";

export type ClipSort = "newest" | "oldest" | "largest";

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

  const [clips, setClips] = useState<ClipEntry[] | null>(null);
  const [usage, setUsage] = useState<ClipStorageUsage | null>(null);
  const [selected, setSelected] = useState<ClipEntry | null>(null);
  const [vertical, setVertical] = useState<ClipEntry | null>(null);
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
    async (clip: ClipEntry, name: string): Promise<boolean> => {
      try {
        const moved = await renameClip(clip.path, name);
        setSelected((current) =>
          current?.path === clip.path ? { ...current, path: moved, name } : current,
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
    [refresh, t],
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
      <div className="flex items-center gap-2 py-6 text-sm text-white/50">
        <Icon icon="svg-spinners:ring-resize" className="h-4 w-4" />
        {t("clips.gallery.loading")}
      </div>
    );
  }

  if (clips.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-6 py-10 text-center">
        <Icon icon="solar:video-library-bold" className="h-8 w-8 text-white/25" />
        <p className="text-sm text-white/60">{t("clips.gallery.empty")}</p>
        <p className="text-xs text-white/35">{t("clips.gallery.empty_hint")}</p>
      </div>
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
        <div className="flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-6 py-10 text-center">
          <Icon
            icon={search.trim() ? "solar:magnifer-linear" : "solar:star-linear"}
            className="h-7 w-7 text-white/20"
          />
          <p className="text-sm text-white/55">
            {search.trim()
              ? t("clips.gallery.no_match", { search: search.trim() })
              : t("clips.gallery.no_favourites")}
          </p>
          {!search.trim() && (
            <p className="max-w-sm text-xs text-white/35">
              {t("clips.gallery.no_favourites_hint")}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-2.5">
        {shown.map((clip) => (
          <ClipCard
            key={clip.path}
            clip={clip}
            busy={busy === clip.path}
            onPlay={() => setSelected(clip)}
            onReveal={() => void revealClip(clip.path).catch(() => {})}
            onDelete={() => void remove(clip)}
            onFavourite={(favourite) => void setFavourite(clip, favourite)}
            onRename={(name) => rename(clip, name)}
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
    </div>
  );
}

function ClipCard({
  clip,
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
  busy: boolean;
  onPlay: () => void;
  onReveal: () => void;
  onDelete: () => void;
  onFavourite: (favourite: boolean) => void;
  onRename: (name: string) => Promise<boolean>;
  onThumbnail: () => void;
  onVertical: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(clip.name);
  const [saving, setSaving] = useState(false);

  const startRenaming = useCallback(() => {
    setDraft(clip.name);
    setRenaming(true);
  }, [clip.name]);

  const commit = useCallback(async () => {
    const wanted = draft.trim();
    if (!wanted || wanted === clip.name) {
      setRenaming(false);
      return;
    }
    setSaving(true);
    const done = await onRename(wanted);
    setSaving(false);
    if (done) setRenaming(false);
  }, [draft, clip.name, onRename]);

  return (
    <div className="group relative overflow-hidden rounded-md border border-white/10 bg-white/[0.02] transition-colors hover:border-white/25">
      <button
        type="button"
        onClick={onPlay}
        className="relative block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        aria-label={t("clips.gallery.play")}
      >
        <ClipThumbnail clip={clip} onStored={onThumbnail} />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/35">
          <Icon
            icon="solar:play-circle-bold"
            className="h-11 w-11 text-white/0 transition-all group-hover:text-white/90"
          />
        </span>
        {clip.durationSeconds !== null && (
          <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] tabular-nums text-white/85">
            {formatLength(clip.durationSeconds)}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={() => onFavourite(!clip.favourite)}
        title={clip.favourite ? t("clips.gallery.unfavourite") : t("clips.gallery.favourite")}
        aria-label={clip.favourite ? t("clips.gallery.unfavourite") : t("clips.gallery.favourite")}
        aria-pressed={clip.favourite}
        className={cn(
          "absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md",
          "bg-black/50 backdrop-blur-sm transition-all",
          "hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40",
          clip.favourite
            ? "text-amber-300 opacity-100"
            : "text-white/60 opacity-0 hover:text-white group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        <Icon
          icon={clip.favourite ? "solar:star-bold" : "solar:star-linear"}
          className="h-4 w-4"
        />
      </button>

      <div className="flex flex-col gap-0.5 px-2.5 py-1.5">
        <div className="flex items-center gap-1">
          {renaming ? (
            <input
              autoFocus
              value={draft}
              disabled={saving}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setRenaming(false);
                }
              }}
              aria-label={t("clips.gallery.rename")}
              className={cn(
                "min-w-0 flex-1 rounded border border-white/25 bg-black/40 px-1.5 py-0.5",
                "text-xs text-white outline-none focus:border-white/50",
                saving && "opacity-50",
              )}
            />
          ) : (
            <button
              type="button"
              onClick={startRenaming}
              title={t("clips.gallery.rename")}
              className="min-w-0 flex-1 truncate rounded px-0.5 text-left text-xs text-white/80 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            >
              {clip.name}
            </button>
          )}

          {!renaming && (
            <div
              className={cn(
                "flex shrink-0 items-center gap-0.5 transition-opacity",
                confirming
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
              )}
            >
              {confirming ? (
                <>
                  <IconButton
                    icon="solar:trash-bin-trash-bold"
                    title={t("clips.gallery.delete_confirm")}
                    tone="danger"
                    busy={busy}
                    onClick={onDelete}
                  />
                  <IconButton
                    icon="solar:close-circle-linear"
                    title={t("clips.gallery.cancel")}
                    onClick={() => setConfirming(false)}
                  />
                </>
              ) : (
                <>
                  <IconButton
                    icon="solar:pen-linear"
                    title={t("clips.gallery.rename")}
                    onClick={startRenaming}
                  />
                  <IconButton
                    icon="solar:smartphone-linear"
                    title={t("clips.gallery.vertical")}
                    onClick={onVertical}
                  />
                  <IconButton
                    icon="solar:folder-with-files-linear"
                    title={t("clips.gallery.reveal")}
                    onClick={onReveal}
                  />
                  <IconButton
                    icon="solar:trash-bin-trash-linear"
                    title={t("clips.gallery.delete")}
                    onClick={() => setConfirming(true)}
                  />
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-baseline gap-2">
          {clip.game && (
            <>
              <span className="shrink-0 truncate text-[11px] text-white/55" title={clip.game}>
                {clip.game}
              </span>
              <span className="shrink-0 text-[11px] text-white/15">·</span>
            </>
          )}
          <span className="truncate text-[11px] text-white/40">
            {formatWhen(clip.createdAt, t)}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-white/30">
            {formatBytes(clip.sizeBytes)}
          </span>
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

function IconButton({
  icon,
  title,
  onClick,
  tone,
  busy,
}: {
  icon: string;
  title: string;
  onClick: () => void;
  tone?: "danger";
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={busy}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md text-white/45 transition-colors",
        "hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
        tone === "danger" && "text-red-300/80 hover:bg-red-500/15 hover:text-red-300",
        busy && "cursor-wait opacity-50",
      )}
    >
      <Icon icon={busy ? "svg-spinners:ring-resize" : icon} className="h-4 w-4 shrink-0" />
    </button>
  );
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
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const src = useMemo(() => convertFileSrc(clip.path), [clip.path]);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [trimming, setTrimming] = useState(false);
  const [duration, setDuration] = useState(0);
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (trimming) setTrimming(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, trimming]);

  useEffect(() => {
    if (trimming) return;
    videoRef.current?.play().catch(() => {
    });
  }, [trimming]);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative flex w-full max-w-5xl flex-col gap-2"
        onClick={(event) => event.stopPropagation()}
        role="presentation"
      >
        <button
          type="button"
          onClick={onClose}
          title={t("clips.gallery.close")}
          aria-label={t("clips.gallery.close")}
          className="absolute -top-1 right-0 -translate-y-full rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <Icon icon="solar:close-circle-linear" className="h-6 w-6" />
        </button>

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
          <video
            ref={videoRef}
            src={src}
            controls
            onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
            className="max-h-[78vh] w-full rounded-lg bg-black"
          />
        )}

        <div className="flex items-baseline gap-2 text-xs">
          <span className="text-white/60">{formatWhen(clip.createdAt, t)}</span>
          <span className="tabular-nums text-white/35">{formatBytes(clip.sizeBytes)}</span>

          {!trimming && (
            <>
              <div className="flex-1" />
              <button
                type="button"
                onClick={onVertical}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Icon icon="solar:smartphone-bold" className="h-3.5 w-3.5" />
                {t("clips.vertical.open")}
              </button>
              <button
                type="button"
                onClick={() => setTrimming(true)}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Icon icon="solar:scissors-bold" className="h-3.5 w-3.5" />
                {t("clips.trim.open")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
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
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const unlimited = usage.limitBytes === 0;
  const ratio = unlimited ? 0 : Math.min(1, usage.usedBytes / usage.limitBytes);
  const tone = ratio > 0.9 ? "bg-amber-400" : "bg-white/40";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-white/55">
          {filtered
            ? t("clips.gallery.count_filtered", { shown, count })
            : t("clips.gallery.count", { count })}
        </span>
        <span className="tabular-nums text-white/40">
          {unlimited
            ? formatBytes(usage.usedBytes)
            : `${formatBytes(usage.usedBytes)} / ${formatBytes(usage.limitBytes)}`}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className={cn("h-full rounded-full transition-all", tone)}
            style={{ width: `${Math.max(2, ratio * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatWhen(
  unixSeconds: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
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
