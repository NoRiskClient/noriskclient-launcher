"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";

import { Button } from "../ui/buttons/Button";
import { ActionButton } from "../ui/ActionButton";
import { EmptyState } from "../ui/EmptyState";
import { SearchWithFilters } from "../ui/SearchWithFilters";
import { Tooltip } from "../ui/Tooltip";
import { formatShortcut } from "../ui/HotkeyInput";
import { useWindowFocus } from "../../hooks/useWindowFocus";
import { ClipGallery, type ClipSort } from "../clips/ClipGallery";
import { getCaptureStatus, openClipFolder } from "../../services/clip-service";
import { getLauncherConfig } from "../../services/launcher-config-service";
import type { CaptureStatus } from "../../types/launcherConfig";
import { useSettingsModalStore } from "../../store/settings-modal-store";
import { useClipsStore } from "../../store/clips-store";
import { setDiscordState } from "../../utils/discordRpc";
import { trackEvent } from "../../services/analytics-service";
import { parseErrorMessage } from "../../utils/error-utils";
import { cn } from "../../lib/utils";

const STATUS_POLL_MS = 2000;
const ALL_GAMES = "__all__";

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
  live: "bg-green-400",
  waiting: "bg-blue-400",
  warn: "bg-yellow-400",
  off: "bg-white/30",
};

export function ClipsPage() {
  const { t } = useTranslation();
  const enabled = useClipsStore((state) => state.enabled);
  const refreshEnabled = useClipsStore((state) => state.refresh);
  const openSettings = useSettingsModalStore((state) => state.open);

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
    void trackEvent("clip_page_opened", { enabled });
  }, [enabled]);

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
    () => [
      { value: "newest", label: t("clips.page.sort.newest"), icon: "solar:sort-by-time-bold" },
      { value: "oldest", label: t("clips.page.sort.oldest"), icon: "solar:history-bold" },
      { value: "largest", label: t("clips.page.sort.largest"), icon: "solar:database-bold" },
    ],
    [t],
  );

  const gameOptions = useMemo(
    () =>
      games.length > 1
        ? [
            { value: ALL_GAMES, label: t("clips.page.all_games"), icon: "solar:gamepad-bold" },
            ...games.map((name) => ({ value: name, label: name })),
          ]
        : [],
    [games, t],
  );

  const toClipSettings = useCallback(
    () => openSettings("clips", { only: true }),
    [openSettings],
  );

  if (!enabled) {
    return (
      <div className="h-full flex flex-col overflow-hidden p-4 relative">
        <EmptyState
          icon="solar:videocamera-record-bold"
          message={t("clips.page.off.title")}
          description={t("clips.page.off.hint")}
          smallDescription
          action={
            <Button
              variant="default"
              size="sm"
              icon={<Icon icon="solar:settings-bold" className="w-4 h-4" />}
              onClick={toClipSettings}
            >
              {t("clips.page.off.action")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 relative">
      <div className="mb-6 pb-4 border-b border-white/10">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <SearchWithFilters
              placeholder={t("clips.page.search")}
              searchValue={search}
              onSearchChange={setSearch}
              sortOptions={sortOptions}
              sortValue={sort}
              onSortChange={(value) => setSort(value as ClipSort)}
              filterOptions={gameOptions}
              filterValue={game ?? ALL_GAMES}
              onFilterChange={(value) => setGame(value === ALL_GAMES ? null : value)}
              dropdownSize="sm"
            />
          </div>

          <div className="flex items-center gap-3">
            <CaptureStatusPill state={state} hotkey={state.tone === "live" ? hotkey : null} t={t} />

            <Tooltip content={t("clips.page.favourites_only")} position="bottom">
              <ActionButton
                icon={favouritesOnly ? "solar:star-bold" : "solar:star-linear"}
                variant={favouritesOnly ? "primary" : "icon-only"}
                onClick={() => setFavouritesOnly((current) => !current)}
              />
            </Tooltip>
            <Tooltip content={t("clips.page.folder")} position="bottom">
              <ActionButton
                icon="solar:folder-open-bold"
                onClick={() =>
                  void openClipFolder().catch((e) => toast.error(parseErrorMessage(e)))
                }
              />
            </Tooltip>
            <Tooltip content={t("clips.page.settings")} position="bottom">
              <ActionButton icon="solar:settings-bold" onClick={toClipSettings} />
            </Tooltip>
          </div>
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

function CaptureStatusPill({
  state,
  hotkey,
  t,
}: {
  state: Health;
  hotkey: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const focused = useWindowFocus();

  const pill = (
    <div className="flex items-center gap-2.5 h-10 px-3 bg-black/30 border border-white/10 rounded-lg">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        {state.tone === "live" && focused && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-60 animate-ping" />
        )}
        <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", TONE_DOT[state.tone])} />
      </span>
      <span className="font-smallcaps text-base text-white/70 whitespace-nowrap">{state.label}</span>
      {hotkey && (
        <>
          <span className="w-px h-3 bg-white/30" />
          <span className="font-minecraft text-xs text-white/60 whitespace-nowrap">
            {t("clips.page.status.hotkey_hint")} {formatShortcut(hotkey)}
          </span>
        </>
      )}
    </div>
  );

  if (!state.detail) return pill;

  return (
    <Tooltip content={state.detail} position="bottom">
      {pill}
    </Tooltip>
  );
}
