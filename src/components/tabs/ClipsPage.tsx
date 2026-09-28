"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { errorKey, getCaptureStatus, openClipFolder, runtimeDownloadPercent } from "../../services/clip-service";
import { getLauncherConfig } from "../../services/launcher-config-service";
import type { CaptureMethod, CaptureStatus, ClipEncoder } from "../../types/launcherConfig";
import { BetaNotice } from "../ui/BetaNotice";
import { StatusMessage } from "../ui/StatusMessage";
import { useSettingsModalStore } from "../../store/settings-modal-store";
import { allCapturePermissionsGranted, useCapturePermissionsStore } from "../../store/capture-permissions-store";
import { isMacOS, supportsClips } from "../../utils/platform";
import { useClipsStore } from "../../store/clips-store";
import { setDiscordState } from "../../utils/discordRpc";
import { trackEvent } from "../../services/analytics-service";
import { parseErrorMessage } from "../../utils/error-utils";
import { cn } from "../../lib/utils";

const STATUS_POLL_MS = 2000;
const DROP_SHARE = 0.05;
const HOOK: CaptureMethod = "graphics hook";
const WINDOW: CaptureMethod = "window capture";
const SCREEN: CaptureMethod = "screen capture";

const ENCODER_NAME: Partial<Record<ClipEncoder, string>> = {
  nvenc: "NVENC",
  amf: "AMF",
  quick_sync: "Quick Sync",
  video_toolbox: "VideoToolbox",
};
const ALL_GAMES = "__all__";
const FEEDBACK_URL = "https://discord.norisk.gg";

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
  if (status?.runtime.state === "downloading") {
    return {
      tone: "waiting",
      label: t("clips.page.status.runtime_downloading", {
        percent: runtimeDownloadPercent(status.runtime),
      }),
      detail: null,
    };
  }
  if (status?.runtime.state === "failed") {
    return { tone: "warn", label: t("clips.page.status.runtime_failed"), detail: status.runtime.message };
  }
  if (!status?.running) {
    return { tone: "off", label: t("clips.page.status.starting"), detail: null };
  }

  switch (status.state) {
    case "buffering":
      return { tone: "live", label: t("clips.page.status.ready"), detail: liveDetail(status, t) };
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
        detail: failedDetail(status, t),
      };
    case "paused":
      return { tone: "waiting", label: t("clips.page.status.paused"), detail: null };
    default:
      return { tone: "waiting", label: t("clips.page.status.idle"), detail: null };
  }
}

function liveDetail(
  status: CaptureStatus,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const method =
    status.capture_method === HOOK
      ? t("clips.page.status.via_hook")
      : status.capture_method === WINDOW
        ? t("clips.page.status.via_window")
        : status.capture_method === SCREEN
          ? t("clips.page.status.via_screen")
          : null;
  const encoder = status.active_encoder
    ? (ENCODER_NAME[status.active_encoder] ?? t("settings.clips.quality.encoder.software"))
    : null;
  const codec = status.active_codec ? t(`settings.clips.quality.codec.${status.active_codec}`) : null;
  const parts = [method, encoder, codec].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function failedDetail(
  status: CaptureStatus,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const reason = status.last_error
    ? t(`overlay.clip.error.${errorKey(status.last_error.code)}`, {
        defaultValue: t("overlay.clip.error.generic"),
      })
    : null;
  const retry =
    status.retry_in_seconds !== null
      ? t("clips.page.status.retry_in", { seconds: status.retry_in_seconds })
      : null;
  return [reason && `${reason}.`, retry, t("clips.page.status.failed_hint")].filter(Boolean).join(" ");
}

function warningsFor(
  status: CaptureStatus | null,
  chosenEncoder: ClipEncoder | null,
  dropping: boolean,
  t: (key: string, options?: Record<string, unknown>) => string,
): string[] {
  if (status?.state === "failed") return [failedDetail(status, t)];
  if (status?.state !== "buffering") return [];
  const warnings: string[] = [];
  if (status.capture_method === WINDOW) warnings.push(t("clips.page.warn.window_capture"));
  if (status.active_encoder === "software" && chosenEncoder !== "software") {
    warnings.push(
      status.capabilities.some((capability) => capability.driver_too_old)
        ? t("settings.clips.quality.encoder.driver_too_old")
        : t("clips.page.warn.cpu_encoder"),
    );
  }
  if (dropping) warnings.push(t("clips.page.warn.dropping"));
  return warnings;
}

const TONE_DOT: Record<Tone, string> = {
  live: "bg-green-400",
  waiting: "bg-blue-400",
  warn: "bg-yellow-400",
  off: "bg-white/30",
};

export function ClipsPage() {
  const { t } = useTranslation();
  const { permissions, error: permissionError } = useCapturePermissionsStore();
  const permissionsBlocked = isMacOS() && supportsClips() && !allCapturePermissionsGranted(permissions);
  const enabled = useClipsStore((state) => state.enabled);
  const refreshEnabled = useClipsStore((state) => state.refresh);
  const openSettings = useSettingsModalStore((state) => state.open);

  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [hotkey, setHotkey] = useState<string | null>(null);
  const [chosenEncoder, setChosenEncoder] = useState<ClipEncoder | null>(null);
  const [dropping, setDropping] = useState(false);
  const drops = useRef({ seen: 0, streak: 0 });
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
        if (cancelled) return;
        setStatus(next);

        const lost = next.dropped_frames - drops.current.seen;
        drops.current.seen = next.dropped_frames;
        const expected = next.capture_fps * (STATUS_POLL_MS / 1000);
        const bad = next.state === "buffering" && lost > Math.max(5, expected * DROP_SHARE);
        drops.current.streak = bad ? drops.current.streak + 1 : 0;
        setDropping(drops.current.streak >= 2);
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
        if (cancelled) return;
        setHotkey(config.clips?.hotkey_save ?? null);
        setChosenEncoder(config.clips?.encoder ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const state: Health = permissionsBlocked ? {
    tone: "warn",
    label: t(permissionError ? "clips.page.status.permissions_error" : permissions ? "clips.page.status.permissions_required" : "settings.clips.permissions.checking"),
    detail: permissionError ?? t("clips.page.status.permissions_hint"),
  } : health(status, enabled, t);

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
          message={permissionsBlocked ? state.label : t("clips.page.off.title")}
          description={permissionsBlocked ? state.detail : t("clips.page.off.hint")}
          smallDescription
          action={
            <Button
              variant="default"
              size="sm"
              icon={<Icon icon="solar:settings-bold" className="w-4 h-4" />}
              onClick={toClipSettings}
            >
              {t(permissionsBlocked ? "settings.clips.permissions.setup" : "clips.page.off.action")}
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

      {permissionsBlocked && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <StatusMessage type="warning" message={state.detail} className="mb-0 min-w-[16rem] flex-1" />
          <Button size="sm" variant="secondary" onClick={toClipSettings}>
            {t("settings.clips.permissions.setup")}
          </Button>
        </div>
      )}

      {!permissionsBlocked &&
        warningsFor(status, chosenEncoder, dropping, t).map((warning) => (
          <div key={warning} className="mb-4 flex flex-wrap items-center gap-3">
            <StatusMessage type="warning" message={warning} className="mb-0 min-w-[16rem] flex-1" />
            <Button size="sm" variant="secondary" onClick={toClipSettings}>
              {t("clips.page.settings")}
            </Button>
          </div>
        ))}

      <BetaNotice
        className="mb-4"
        tag={t("clips.page.beta_tag")}
        hint={t("clips.page.beta_hint")}
        feedbackLabel={t("clips.page.feedback")}
        feedbackUrl={FEEDBACK_URL}
      />

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
