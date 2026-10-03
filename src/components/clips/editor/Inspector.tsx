"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";

import { Input } from "../../ui/Input";
import { RangeSlider } from "../../ui/RangeSlider";
import { Tooltip } from "../../ui/Tooltip";
import type { ClipCorner, ClipOverlay } from "../../../services/clip-service";
import { ClipIconButton } from "../ClipIconButton";
import { cn } from "../../../lib/utils";
import { ColorPickerModal } from "../../modals/ColorPickerModal";
import { useGlobalModal } from "../../../hooks/useGlobalModal";
import { OVERLAY_ICON, OVERLAY_NAME, formatTime, toHex, overlayTint, type Translate } from "./shared";

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
    <h3 className="flex items-center gap-2 border-b border-white/10 pb-2 font-minecraft text-xs uppercase leading-none tracking-wider text-white/60">
      <span className="h-3 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </h3>
  );
}

function PropSlider({
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

function ShadeChoice({
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
  const [typed, setTyped] = useState(toHex(value));

  useEffect(() => {
    setTyped(toHex(value));
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
        <Tooltip content={t("clips.editor.overlay.colour.pick")} position="top" wrapperClassName="shrink-0">
          <button
            type="button"
            disabled={disabled}
            aria-label={t("clips.editor.overlay.colour.pick")}
            onClick={() =>
              showModal(
                OVERLAY_COLOUR_MODAL,
                <ColorPickerModal
                  initialColor={toHex(value)}
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
            style={{ backgroundColor: toHex(value) }}
          />
        </Tooltip>

        <div className="min-w-0 flex-1" onBlur={() => setTyped(toHex(value))}>
          <Input
            size="sm"
            value={typed}
            disabled={disabled}
            maxLength={7}
            aria-label={t("clips.editor.overlay.colour.hex")}
            onChange={(event) => accept(event.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map((preset) => (
          <Tooltip key={preset} content={toHex(preset)} position="top">
            <button
              type="button"
              disabled={disabled}
              aria-label={toHex(preset)}
              onClick={() => onChange(preset)}
              className={cn(
                "h-5 w-5 shrink-0 rounded border transition-colors",
                value === preset ? "border-white" : "border-white/20 hover:border-white/60",
                disabled && "cursor-not-allowed opacity-40",
              )}
              style={{ backgroundColor: toHex(preset) }}
            />
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function CornerChoice({
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
          <Tooltip key={corner.value} content={t(corner.label)} position="top">
            <button
              type="button"
              disabled={disabled}
              aria-label={t(corner.label)}
              aria-pressed={value === corner.value}
              onClick={() => onChange(corner.value)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded border transition-colors",
                value === corner.value
                  ? "border-white/20 bg-white/10 text-white"
                  : "border-white/10 bg-black/30 text-white/60",
                disabled
                  ? "cursor-not-allowed opacity-40"
                  : value !== corner.value && "hover:border-white/20 hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon
                icon="solar:arrow-right-up-bold"
                className="h-3.5 w-3.5"
                style={{
                  transform: `rotate(${corner.turn}deg)`,
                  color: value === corner.value ? color : undefined,
                }}
              />
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

export function OverlayInspector({
  picked,
  chosen,
  accent,
  busy,
  editOverlay,
  dropOverlay,
  t,
}: {
  picked: ClipOverlay | null;
  chosen: number | null;
  accent: string;
  busy: boolean;
  editOverlay: (index: number, patch: Partial<ClipOverlay>) => void;
  dropOverlay: (index: number) => void;
  t: Translate;
}) {
  return (
    <aside className="custom-scrollbar flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/10 bg-black/20 p-4">
      <PanelTitle color={accent}>{t("clips.editor.inspector")}</PanelTitle>

      {picked === null || chosen === null ? (
        <p className="font-minecraft text-xs leading-relaxed text-white/50">
          {t("clips.editor.inspector.empty")}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded border border-white/20 bg-white/10 px-3 py-2">
            <Icon
              icon={OVERLAY_ICON[picked.kind]}
              className="h-4 w-4 shrink-0"
              style={{ color: overlayTint(picked, accent) }}
            />
            <span className="min-w-0 flex-1 truncate font-minecraft text-sm text-white">
              {t(OVERLAY_NAME[picked.kind], { index: chosen + 1 })}
            </span>
            <ClipIconButton
              icon="solar:trash-bin-trash-bold"
              label={t("clips.editor.overlay.remove")}
              tone="danger"
              tooltipPosition="bottom"
              onClick={() => dropOverlay(chosen)}
              disabled={busy}
            />
          </div>

          <p className="font-minecraft text-xs text-white/50">
            {t("clips.editor.overlay.window", {
              from: formatTime(picked.startSeconds),
              to: formatTime(picked.endSeconds),
            })}
          </p>

          {picked.kind === "blur" && (
            <PropSlider
              label={t("clips.editor.overlay.strength")}
              value={picked.strength}
              min={1}
              max={64}
              disabled={busy}
              onChange={(strength) => editOverlay(chosen, { strength })}
            />
          )}

          {picked.kind === "box" && (
            <ShadeChoice
              label={t("clips.editor.overlay.colour")}
              value={picked.colour}
              disabled={busy}
              onChange={(colour) => editOverlay(chosen, { colour })}
              t={t}
            />
          )}

          {picked.kind === "arrow" && (
            <>
              <ShadeChoice
                label={t("clips.editor.overlay.colour")}
                value={picked.colour}
                disabled={busy}
                onChange={(colour) => editOverlay(chosen, { colour })}
                t={t}
              />
              <PropSlider
                label={t("clips.editor.overlay.thickness")}
                value={picked.thickness}
                min={1}
                max={32}
                disabled={busy}
                onChange={(thickness) => editOverlay(chosen, { thickness })}
              />
              <CornerChoice
                label={t("clips.editor.overlay.towards")}
                value={picked.towards}
                color={accent}
                disabled={busy}
                onChange={(towards) => editOverlay(chosen, { towards })}
                t={t}
              />
            </>
          )}

          {picked.kind === "text" && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="font-minecraft text-sm text-white/80">
                  {t("clips.editor.overlay.text")}
                </span>
                <Input
                  size="sm"
                  value={picked.content}
                  disabled={busy}
                  placeholder={t("clips.editor.overlay.text_placeholder")}
                  aria-label={t("clips.editor.overlay.text")}
                  onChange={(event) => editOverlay(chosen, { content: event.target.value })}
                />
              </div>
              <PropSlider
                label={t("clips.editor.overlay.size")}
                value={picked.size}
                min={8}
                max={240}
                disabled={busy}
                onChange={(size) => editOverlay(chosen, { size })}
              />
              <ShadeChoice
                label={t("clips.editor.overlay.colour")}
                value={picked.colour}
                disabled={busy}
                onChange={(colour) => editOverlay(chosen, { colour })}
                t={t}
              />
              {picked.content.trim() === "" && (
                <p className="flex items-start gap-2 font-minecraft text-xs leading-relaxed text-amber-300">
                  <Icon icon="solar:danger-triangle-bold" className="mt-0.5 h-4 w-4 shrink-0" />
                  {t("clips.editor.overlay.text_empty")}
                </p>
              )}
            </>
          )}
        </>
      )}
    </aside>
  );
}
