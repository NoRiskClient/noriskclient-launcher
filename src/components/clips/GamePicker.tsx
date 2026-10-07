"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";

import { Button } from "../ui/buttons/Button";
import { GroupTabs } from "../ui/GroupTabs";
import { useThemeStore } from "../../store/useThemeStore";
import { listOpenApps, listScreens, type OpenApp, type ScreenInfo } from "../../services/clip-service";
import type { OtherGame, OtherScreen } from "../../types/launcherConfig";
import { cn } from "../../lib/utils";
import { isMacOS } from "../../utils/platform";

interface Props {
  value: OtherGame | null;
  onChange: (game: OtherGame | null) => void;
  disabled: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  icon?: string;
  noneDescription?: string;
  screen?: OtherScreen | null;
  onScreen?: (screen: OtherScreen) => void;
}

export function GamePicker({
  value,
  onChange,
  disabled,
  t,
  icon = "solar:gamepad-bold",
  noneDescription,
  screen = null,
  onScreen,
}: Props) {
  const [apps, setApps] = useState<OpenApp[] | null>(null);
  const [screens, setScreens] = useState<ScreenInfo[] | null>(null);
  const [appsError, setAppsError] = useState(false);
  const [screensError, setScreensError] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const requestRef = useRef(0);
  const accentColor = useThemeStore((state) => state.accentColor);
  const offerScreens = Boolean(onScreen) && !isMacOS();
  const [view, setView] = useState<"apps" | "screens">(screen ? "screens" : "apps");
  const showing = offerScreens ? view : "apps";

  const refresh = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const request = ++requestRef.current;
    const isCurrent = () => requestRef.current === request;
    setLoading(true);
    setAppsError(false);
    setScreensError(false);
    try {
      await Promise.all([
        listOpenApps()
          .then((open) => { if (isCurrent()) setApps(open); })
          .catch((error) => {
            if (!isCurrent()) return;
            console.error("Could not list the open programs", error);
            setAppsError(true);
          }),
        offerScreens
          ? listScreens()
              .then((shown) => { if (isCurrent()) setScreens(shown); })
              .catch((error) => {
                if (!isCurrent()) return;
                console.error("Could not list the screens", error);
                setScreensError(true);
              })
          : Promise.resolve(),
      ]);
    } finally {
      if (isCurrent()) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [offerScreens]);

  useEffect(() => {
    void refresh();
    return () => {
      requestRef.current += 1;
      loadingRef.current = false;
    };
  }, [refresh]);

  const rows: OpenApp[] = apps ? [...apps] : [];
  const chosenIsOpen =
    value && rows.some((app) => app.executable === value.executable);
  if (value && !chosenIsOpen) {
    rows.unshift({ pid: 0, executable: value.executable, name: value.name });
  }

  return (
    <div className={cn("flex flex-col gap-2 rounded-lg bg-black/20 border border-white/10 p-3", disabled && "opacity-50")} aria-busy={loading}>
      <div className="flex items-center gap-2">
        {offerScreens ? (
          <GroupTabs
            groups={[
              {
                id: "apps",
                icon: "solar:widget-bold",
                name: `${t("settings.clips.games.apps")}${apps !== null && !appsError ? ` (${apps.length})` : ""}`,
                count: apps?.length ?? 0,
              },
              {
                id: "screens",
                icon: "solar:monitor-bold",
                name: `${t("settings.clips.games.screens")}${screens !== null && !screensError ? ` (${screens.length})` : ""}`,
                count: screens?.length ?? 0,
              },
            ]}
            activeGroup={showing}
            onGroupChange={(id) => setView(id === "screens" ? "screens" : "apps")}
            showAddButton={false}
            className="!mb-0 flex-1"
          />
        ) : (
          <p className="flex-1 font-minecraft text-xs text-white/50">{t("settings.clips.games.open")}</p>
        )}
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void refresh()}
          disabled={disabled || loading}
          icon={
            <Icon
              icon={loading ? "svg-spinners:ring-resize" : "solar:refresh-bold"}
              className="w-4 h-4"
            />
          }
        >
          {t(appsError || screensError ? "common.retry" : "settings.clips.games.refresh")}
        </Button>
      </div>

      {loading && <p className="px-2 font-minecraft text-xs text-white/60" role="status">{t("common.loading")}</p>}
      {appsError && (
        <p className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 font-minecraft text-xs text-red-200 break-words" role="alert">
          {t("settings.clips.games.apps_error")}
        </p>
      )}
      {offerScreens && screensError && (
        <p className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 font-minecraft text-xs text-red-200 break-words" role="alert">
          {t("settings.clips.games.screens_error")}
        </p>
      )}

      <div className="flex max-h-64 flex-col gap-1 overflow-y-auto custom-scrollbar pr-1">
        <Row
          icon="solar:close-circle-bold"
          name={t("settings.clips.games.none")}
          detail={noneDescription ?? t("settings.clips.games.none.description")}
          selected={value === null && screen === null}
          disabled={disabled}
          onSelect={() => onChange(null)}
        />

        {showing === "apps" && rows.map((app) => (
          <Row
            key={app.executable}
            icon={icon}
            name={app.name}
            detail={
              app.pid === 0
                ? t(apps !== null && !appsError && !loading ? "settings.clips.games.closed" : "settings.clips.games.saved_selection", { executable: app.executable })
                : app.executable
            }
            selected={value?.executable === app.executable}
            disabled={disabled}
            onSelect={() =>
              onChange({ executable: app.executable, name: app.name })
            }
          />
        ))}

        {showing === "apps" && !loading && !appsError && apps !== null && apps.length === 0 && (
          <p className="px-2 py-3 text-center font-minecraft text-xs text-white/40">
            {t("settings.clips.games.empty")}
          </p>
        )}

        {showing === "screens" && (
          <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-3">
            {(screens ?? []).map((shown, index) => {
              const name = t("settings.clips.games.screen", { number: index + 1 });
              const selected = screen?.device === shown.device;
              return (
                <button
                  key={shown.device}
                  type="button"
                  onClick={() => onScreen?.({ device: shown.device, name })}
                  disabled={disabled}
                  aria-pressed={selected}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border px-3 pb-2.5 pt-3 transition-all duration-200",
                    selected
                      ? "text-white"
                      : "border-white/10 bg-black/20 hover:border-white/25 hover:bg-black/30",
                    disabled && "cursor-not-allowed",
                  )}
                  style={
                    selected
                      ? { backgroundColor: `${accentColor.value}20`, borderColor: accentColor.value }
                      : undefined
                  }
                >
                  <span
                    className="relative flex w-full max-w-[9rem] items-center justify-center rounded-md border-2 bg-black/40"
                    style={{
                      aspectRatio: `${Math.max(shown.width, 1)} / ${Math.max(shown.height, 1)}`,
                      borderColor: selected ? accentColor.value : "rgba(255,255,255,0.25)",
                    }}
                  >
                    <span className="font-minecraft text-2xl text-white/80">{index + 1}</span>
                    {shown.primary && (
                      <Icon
                        icon="solar:star-bold"
                        className="absolute right-1 top-1 h-3 w-3 text-yellow-400"
                      />
                    )}
                  </span>
                  <span className="h-1 w-8 rounded-b bg-white/20" />
                  <span className="font-minecraft text-sm text-white/90">{name}</span>
                  <span className="font-minecraft text-xs text-white/40">
                    {shown.width} × {shown.height}
                    {shown.primary ? ` · ${t("settings.clips.games.screen.primary")}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {showing === "screens" && !loading && !screensError && screens !== null && screens.length === 0 && (
          <p className="px-2 py-3 text-center font-minecraft text-xs text-white/40">
            {t("settings.clips.games.screens_empty")}
          </p>
        )}
      </div>

      {offerScreens && screen && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 font-minecraft text-xs leading-relaxed text-amber-200">
          <Icon icon="solar:danger-triangle-bold" className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          {t("settings.clips.games.screen.hint")}
        </p>
      )}
    </div>
  );
}

function Row({
  icon,
  name,
  detail,
  selected,
  disabled,
  onSelect,
}: {
  icon: string;
  name: string;
  detail: string;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const accentColor = useThemeStore((state) => state.accentColor);

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all duration-200",
        selected
          ? "text-white"
          : "border-transparent bg-transparent hover:bg-black/30 hover:border-white/10",
        disabled && "cursor-not-allowed",
      )}
      style={
        selected
          ? { backgroundColor: `${accentColor.value}20`, borderColor: `${accentColor.value}60` }
          : undefined
      }
    >
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors"
        style={{
          borderColor: selected ? accentColor.value : "rgba(255,255,255,0.3)",
          backgroundColor: selected ? accentColor.value : undefined,
        }}
      >
        {selected && <span className="h-1.5 w-1.5 rounded-full bg-black/70" />}
      </span>

      <Icon
        icon={icon}
        className={cn("h-4 w-4 shrink-0", selected ? "text-white" : "text-white/40")}
      />

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-minecraft text-sm text-white/90">{name}</span>
        <span className="truncate font-minecraft text-xs text-white/40">{detail}</span>
      </span>
    </button>
  );
}
