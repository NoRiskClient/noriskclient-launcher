"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@iconify/react";

import { Button } from "../ui/buttons/Button";
import { useThemeStore } from "../../store/useThemeStore";
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
    <div className={cn("flex flex-col gap-2 rounded-lg bg-black/20 border border-white/10 p-3", disabled && "opacity-50")}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-minecraft text-xs text-white/50">{t("settings.clips.games.open")}</p>
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
          {t("settings.clips.games.refresh")}
        </Button>
      </div>

      <div className="flex max-h-64 flex-col gap-1 overflow-y-auto custom-scrollbar pr-1">
        <Row
          icon="solar:close-circle-bold"
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
          <p className="px-2 py-3 text-center font-minecraft text-xs text-white/40">
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
