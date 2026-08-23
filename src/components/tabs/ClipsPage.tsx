"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

import { Button } from "../ui/buttons/Button";
import { ClipGallery, type ClipSort } from "../clips/ClipGallery";
import {
  ClipGameFilter,
  ClipSearchField,
  ClipSortSwitch,
  ClipToolButton,
} from "../clips/ClipToolbar";
import { getCaptureStatus, openClipFolder } from "../../services/clip-service";
import { getLauncherConfig } from "../../services/launcher-config-service";
import type { CaptureStatus } from "../../types/launcherConfig";
import { useSettingsModalStore } from "../../store/settings-modal-store";
import { useClipsStore } from "../../store/clips-store";
import { useThemeStore } from "../../store/useThemeStore";
import { setDiscordState } from "../../utils/discordRpc";
import { cn } from "../../lib/utils";

const STATUS_POLL_MS = 2000;

type Tone = "live" | "waiting" | "warn" | "off";

interface Health {
  tone: Tone;
  label: string;
  detail: string | null;
}

function health(
  status: CaptureStatus | null,
  enabled: boolean,
  t: (key: string, options?: Record<string, unknown>) => string,
): Health {
  if (!enabled) {
    return { tone: "off", label: t("clips.page.status.disabled"), detail: null };
  }
  if (!status?.running) {
    return { tone: "off", label: t("clips.page.status.starting"), detail: null };
  }

  switch (status.state) {
    case "buffering":
      return { tone: "live", label: t("clips.page.status.ready"), detail: null };
    case "attaching":
      return { tone: "waiting", label: t("clips.page.status.attaching"), detail: null };
    case "blocked_fullscreen_exclusive":
      return {
        tone: "warn",
        label: t("clips.page.status.blocked"),
        detail: t("clips.page.status.blocked_hint"),
      };
    case "failed":
      return {
        tone: "warn",
        label: t("clips.page.status.failed"),
        detail: t("clips.page.status.failed_hint"),
      };
    case "paused":
      return { tone: "waiting", label: t("clips.page.status.paused"), detail: null };
    default:
      return { tone: "waiting", label: t("clips.page.status.idle"), detail: null };
  }
}

const TONE_DOT: Record<Tone, string> = {
  live: "bg-emerald-400",
  waiting: "bg-sky-400",
  warn: "bg-amber-400",
  off: "bg-white/30",
};

const TONE_TEXT: Record<Tone, string> = {
  live: "text-emerald-300/90",
  waiting: "text-sky-300/90",
  warn: "text-amber-300/90",
  off: "text-white/40",
};

export function ClipsPage() {
  const { t } = useTranslation();
  const enabled = useClipsStore((state) => state.enabled);
  const refreshEnabled = useClipsStore((state) => state.refresh);
  const openSettings = useSettingsModalStore((state) => state.open);
  const accentColor = useThemeStore((state) => state.accentColor);

  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [hotkey, setHotkey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ClipSort>("newest");
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [games, setGames] = useState<string[]>([]);
  const [game, setGame] = useState<string | null>(null);

  useEffect(() => {
    if (game && !games.includes(game)) setGame(null);
  }, [games, game]);

  useEffect(() => {
    setDiscordState("Browsing Clips");
  }, []);

  useEffect(() => {
    void refreshEnabled();
  }, [refreshEnabled]);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const next = await getCaptureStatus();
        if (!cancelled) setStatus(next);
      } catch {
        if (!cancelled) setStatus(null);
      }
    };
    void read();
    const timer = setInterval(read, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getLauncherConfig()
      .then((config) => {
        if (!cancelled) setHotkey(config.clips?.hotkey_save ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const state = useMemo(() => health(status, enabled, t), [status, enabled, t]);

  const sortOptions = useMemo(
    () =>
      [
        { value: "newest" as const, label: t("clips.page.sort.newest") },
        { value: "oldest" as const, label: t("clips.page.sort.oldest") },
        { value: "largest" as const, label: t("clips.page.sort.largest") },
      ],
    [t],
  );

  const toClipSettings = useCallback(
    () => openSettings("clips", { only: true }),
    [openSettings],
  );

  if (!enabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <Icon icon="solar:videocamera-record-bold" className="h-10 w-10 text-white/20" />
        <div className="space-y-1">
          <p className="font-smallcaps text-lg text-white/75">{t("clips.page.off.title")}</p>
          <p className="max-w-sm text-xs leading-relaxed text-white/40">
            {t("clips.page.off.hint")}
          </p>
        </div>
        <Button size="sm" onClick={toClipSettings}>
          {t("clips.page.off.action")}
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden p-4">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-white/10 pb-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <Icon
              icon="solar:videocamera-record-bold"
              className="h-6 w-6 shrink-0"
              style={{ color: accentColor.value }}
            />
            <h1 className="font-smallcaps text-2xl leading-none text-white">
              {t("nav.clips")}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-[2.1rem]">
            <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
              {state.tone === "live" && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
              )}
              <span className={cn("h-2 w-2 rounded-full", TONE_DOT[state.tone])} />
            </span>
            <span className={cn("text-xs", TONE_TEXT[state.tone])}>{state.label}</span>
            {state.tone === "live" && hotkey && (
              <span className="flex items-center gap-1.5 text-xs text-white/30">
                <span className="text-white/15">·</span>
                {t("clips.page.status.hotkey_hint")}
                <kbd className="rounded border border-white/15 bg-white/[0.06] px-1.5 py-px font-mono text-[10px] text-white/70">
                  {hotkey}
                </kbd>
              </span>
            )}
            {state.detail && (
              <span className="flex items-center gap-1.5 text-xs text-white/35">
                <span className="text-white/15">·</span>
                {state.detail}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {games.length > 1 && (
            <ClipGameFilter
              value={game}
              onChange={setGame}
              games={games}
              allLabel={t("clips.page.all_games")}
              t={t}
            />
          )}
          <ClipSearchField
            value={search}
            onChange={setSearch}
            placeholder={t("clips.page.search")}
            clearLabel={t("clips.page.search_clear")}
          />
          <ClipSortSwitch value={sort} onChange={setSort} options={sortOptions} />
          <ClipToolButton
            icon={favouritesOnly ? "solar:star-bold" : "solar:star-linear"}
            label={t("clips.page.favourites_only")}
            active={favouritesOnly}
            onClick={() => setFavouritesOnly((current) => !current)}
          />
          <ClipToolButton
            icon="solar:folder-open-bold"
            label={t("clips.page.folder")}
            onClick={() => void openClipFolder().catch(() => {})}
          />
          <ClipToolButton
            icon="solar:settings-bold"
            label={t("clips.page.settings")}
            onClick={toClipSettings}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar">
        <ClipGallery
          search={search}
          sort={sort}
          favouritesOnly={favouritesOnly}
          game={game}
          onGamesChange={setGames}
        />
      </div>
    </div>
  );
}
