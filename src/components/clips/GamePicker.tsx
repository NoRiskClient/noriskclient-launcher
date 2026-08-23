"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@iconify/react";

import { listOpenApps, type OpenApp } from "../../services/clip-service";
import type { OtherGame } from "../../types/launcherConfig";
import { cn } from "../../lib/utils";

interface Props {
  value: OtherGame | null;
  onChange: (game: OtherGame | null) => void;
  disabled: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function GamePicker({ value, onChange, disabled, t }: Props) {
  const [apps, setApps] = useState<OpenApp[] | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setApps(await listOpenApps());
    } catch (e) {
      console.error("Could not list the open programs", e);
      setApps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows: OpenApp[] = apps ? [...apps] : [];
  const chosenIsOpen =
    value && rows.some((app) => app.executable === value.executable);
  if (value && !chosenIsOpen) {
    rows.unshift({ pid: 0, executable: value.executable, name: value.name });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-2">
      <div className="flex items-center justify-between gap-2 px-1.5 pt-0.5">
        <p className="text-xs text-white/40">{t("settings.clips.games.open")}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={disabled || loading}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-white/50 transition-colors",
            "hover:bg-white/10 hover:text-white",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
            (disabled || loading) && "cursor-not-allowed opacity-40",
          )}
        >
          <Icon
            icon={loading ? "svg-spinners:ring-resize" : "solar:refresh-linear"}
            className="h-3.5 w-3.5"
          />
          {t("settings.clips.games.refresh")}
        </button>
      </div>

      <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
        <Row
          icon="solar:close-circle-linear"
          name={t("settings.clips.games.none")}
          detail={t("settings.clips.games.none.description")}
          selected={value === null}
          disabled={disabled}
          onSelect={() => onChange(null)}
        />

        {rows.map((app) => (
          <Row
            key={app.executable}
            icon="solar:gamepad-bold"
            name={app.name}
            detail={
              app.pid === 0
                ? t("settings.clips.games.closed", { executable: app.executable })
                : app.executable
            }
            selected={value?.executable === app.executable}
            disabled={disabled}
            onSelect={() =>
              onChange({ executable: app.executable, name: app.name })
            }
          />
        ))}

        {apps !== null && apps.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-white/30">
            {t("settings.clips.games.empty")}
          </p>
        )}
      </div>
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
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "flex items-center gap-3 rounded-md px-1.5 py-1.5 text-left transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
        selected ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
          selected ? "border-white bg-white" : "border-white/25",
        )}
      >
        {selected && <span className="h-1.5 w-1.5 rounded-full bg-black" />}
      </span>

      <Icon
        icon={icon}
        className={cn("h-4 w-4 shrink-0", selected ? "text-white/70" : "text-white/25")}
      />

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-white/80">{name}</span>
        <span className="truncate text-[11px] text-white/30">{detail}</span>
      </span>
    </button>
  );
}
