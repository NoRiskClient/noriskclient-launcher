"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";

import { RangeSlider } from "../../ui/RangeSlider";
import type { ClipCorner } from "../../../services/clip-service";
import { cn } from "../../../lib/utils";
import { ColorPickerModal } from "../../modals/ColorPickerModal";
import { useGlobalModal } from "../../../hooks/useGlobalModal";
import { grey, type Translate } from "./shared";

const OVERLAY_COLOUR_MODAL = "clip-overlay-colour";

const SWATCHES: number[] = [0xffffff, 0x000000, 0xff3b30, 0xffcc00, 0x34c759, 0x0a84ff];

const CORNERS: { value: ClipCorner; label: string; turn: number }[] = [
  { value: "top_left", label: "clips.editor.overlay.corner.top_left", turn: -90 },
  { value: "top_right", label: "clips.editor.overlay.corner.top_right", turn: 0 },
  { value: "bottom_left", label: "clips.editor.overlay.corner.bottom_left", turn: 180 },
  { value: "bottom_right", label: "clips.editor.overlay.corner.bottom_right", turn: 90 },
];

export function PanelTitle({ children, color }: { children: ReactNode; color: string }) {
  return (
    <h3
      className="border-b border-white/10 pb-2 font-smallcaps text-lg leading-none tracking-wide"
      style={{ color }}
    >
      {children}
    </h3>
  );
}

export function PropSlider({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-minecraft text-sm text-white/80">{label}</span>
        <span className="shrink-0 font-minecraft text-sm tabular-nums text-white">{value}</span>
      </div>
      <RangeSlider
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={1}
        size="sm"
        showValue={false}
        disabled={disabled}
        label={label}
      />
    </div>
  );
}

export function ShadeChoice({
  label,
  value,
  disabled,
  onChange,
  t,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (colour: number) => void;
  t: Translate;
}) {
  const { showModal, hideModal } = useGlobalModal();
  const [typed, setTyped] = useState(grey(value));

  useEffect(() => {
    setTyped(grey(value));
  }, [value]);

  const accept = (text: string) => {
    setTyped(text);
    const cleaned = text.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}$/.test(cleaned)) onChange(parseInt(cleaned, 16));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-minecraft text-sm text-white/80">{label}</span>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-label={t("clips.editor.overlay.colour.pick")}
          title={t("clips.editor.overlay.colour.pick")}
          onClick={() =>
            showModal(
              OVERLAY_COLOUR_MODAL,
              <ColorPickerModal
                initialColor={grey(value)}
                applyToTheme={false}
                onColorSelected={(picked) => accept(picked)}
                onClose={() => hideModal(OVERLAY_COLOUR_MODAL)}
              />,
              1200,
            )
          }
          className={cn(
            "h-7 w-7 shrink-0 rounded border border-white/20 transition-colors",
            disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:border-white/60",
          )}
          style={{ backgroundColor: grey(value) }}
        />

        <input
          type="text"
          value={typed}
          disabled={disabled}
          spellCheck={false}
          maxLength={7}
          aria-label={t("clips.editor.overlay.colour.hex")}
          onChange={(event) => accept(event.target.value)}
          onBlur={() => setTyped(grey(value))}
          className={cn(
            "min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 font-minecraft text-sm uppercase text-white/90 outline-none transition-colors",
            disabled ? "cursor-not-allowed opacity-40" : "hover:border-white/40 focus:border-white/60",
          )}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={disabled}
            aria-label={grey(preset)}
            title={grey(preset)}
            onClick={() => onChange(preset)}
            className={cn(
              "h-5 w-5 shrink-0 rounded border transition-colors",
              value === preset ? "border-white" : "border-white/20 hover:border-white/60",
              disabled && "cursor-not-allowed opacity-40",
            )}
            style={{ backgroundColor: grey(preset) }}
          />
        ))}
      </div>
    </div>
  );
}

export function CornerChoice({
  label,
  value,
  color,
  disabled,
  onChange,
  t,
}: {
  label: string;
  value: ClipCorner;
  color: string;
  disabled: boolean;
  onChange: (corner: ClipCorner) => void;
  t: Translate;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-minecraft text-sm text-white/80">{label}</span>
      <div className="grid w-fit grid-cols-2 gap-1">
        {CORNERS.map((corner) => (
          <button
            key={corner.value}
            type="button"
            disabled={disabled}
            aria-label={t(corner.label)}
            aria-pressed={value === corner.value}
            title={t(corner.label)}
            onClick={() => onChange(corner.value)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg border transition-colors",
              value === corner.value
                ? "text-white"
                : "border-white/10 bg-black/20 text-white/50 hover:border-white/20 hover:text-white",
              disabled && "cursor-not-allowed opacity-40",
            )}
            style={
              value === corner.value
                ? { borderColor: color, backgroundColor: `${color}30` }
                : undefined
            }
          >
            <Icon
              icon="solar:arrow-right-up-bold"
              className="h-3.5 w-3.5"
              style={{ transform: `rotate(${corner.turn}deg)` }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
