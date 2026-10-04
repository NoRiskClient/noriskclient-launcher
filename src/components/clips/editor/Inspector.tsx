"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";

import { SearchStyleInput } from "../../ui/Input";
import { RangeSlider } from "../../ui/RangeSlider";
import { Tooltip } from "../../ui/Tooltip";
import type { ClipCorner, ClipOverlay, ClipTextAlign, ClipTextVertical } from "../../../services/clip-service";
import { ClipIconButton } from "../ClipIconButton";
import { cn } from "../../../lib/utils";
import { ColorPickerModal } from "../../modals/ColorPickerModal";
import { useGlobalModal } from "../../../hooks/useGlobalModal";
import { OVERLAY_ICON, OVERLAY_NAME, formatTime, toHex, overlayTint, type Translate } from "./shared";
import { CARD, PANEL_HEAD } from "./EditorLayout";

const OVERLAY_COLOUR_MODAL = "clip-overlay-colour";

const SWATCHES: number[] = [0xffffff, 0x000000, 0xff3b30, 0xffcc00, 0x34c759, 0x0a84ff];

const DIRECTIONS: ({ value: ClipCorner; label: string; turn: number } | null)[] = [
  { value: "top_left", label: "clips.editor.overlay.corner.top_left", turn: -90 },
  { value: "top", label: "clips.editor.overlay.corner.top", turn: -45 },
  { value: "top_right", label: "clips.editor.overlay.corner.top_right", turn: 0 },
  { value: "left", label: "clips.editor.overlay.corner.left", turn: -135 },
  null,
  { value: "right", label: "clips.editor.overlay.corner.right", turn: 45 },
  { value: "bottom_left", label: "clips.editor.overlay.corner.bottom_left", turn: 180 },
  { value: "bottom", label: "clips.editor.overlay.corner.bottom", turn: 135 },
  { value: "bottom_right", label: "clips.editor.overlay.corner.bottom_right", turn: 90 },
];

const HORIZONTAL: ClipTextAlign[] = ["left", "center", "right"];

const VERTICAL: ClipTextVertical[] = ["top", "center", "bottom"];

export function PanelTitle({ children, color }: { children: ReactNode; color: string }) {
  return (
    <div className={PANEL_HEAD}>
      <h3 className="flex min-w-0 items-center gap-2 font-minecraft text-xs uppercase leading-none tracking-wider text-white/60">
        <span className="h-3 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate">{children}</span>
      </h3>
    </div>
  );
}

function Field({ label, value, children }: { label: string; value?: number; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-minecraft text-xs uppercase tracking-wider text-white/50">
          {label}
        </span>
        {value !== undefined && (
          <span className="shrink-0 font-minecraft text-xs tabular-nums text-white">{value}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function GridButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded border",
        active ? "border-white/20 bg-white/10 text-white" : "border-white/10 bg-black/30 text-white/60",
        disabled
          ? "cursor-not-allowed opacity-40"
          : !active && "hover:border-white/20 hover:bg-white/5 hover:text-white",
      )}
    >
      {children}
    </button>
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
    <Field label={label} value={value}>
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
    </Field>
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
    <Field label={label}>
      <div className="flex items-stretch gap-2">
        <Tooltip content={t("clips.editor.overlay.colour.pick")} position="top" wrapperClassName="flex shrink-0">
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
              "h-full aspect-square shrink-0 rounded-lg border border-white/20 transition-colors",
              disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:border-white/60",
            )}
            style={{ backgroundColor: toHex(value) }}
          />
        </Tooltip>

        <div className="min-w-0 flex-1" onBlur={() => setTyped(toHex(value))}>
          <SearchStyleInput
            icon="solar:hashtag-bold"
            value={typed.replace(/^#/, "")}
            disabled={disabled}
            maxLength={7}
            placeholder="ffffff"
            aria-label={t("clips.editor.overlay.colour.hex")}
            className="min-w-0 text-sm uppercase"
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
                "h-6 w-6 shrink-0 rounded border transition-colors",
                value === preset
                  ? "border-white ring-1 ring-white/60 ring-offset-1 ring-offset-black"
                  : "border-white/20 hover:border-white/60",
                disabled && "cursor-not-allowed opacity-40",
              )}
              style={{ backgroundColor: toHex(preset) }}
            />
          </Tooltip>
        ))}
      </div>
    </Field>
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
    <Field label={label}>
      <div className="grid w-fit grid-cols-3 gap-1">
        {DIRECTIONS.map((direction, index) =>
          direction === null ? (
            <span key={index} className="h-7 w-7" />
          ) : (
            <GridButton
              key={direction.value}
              label={t(direction.label)}
              active={value === direction.value}
              disabled={disabled}
              onClick={() => onChange(direction.value)}
            >
              <Icon
                icon="solar:arrow-right-up-bold"
                className="h-3.5 w-3.5"
                style={{
                  transform: `rotate(${direction.turn}deg)`,
                  color: value === direction.value ? color : undefined,
                }}
              />
            </GridButton>
          ),
        )}
      </div>
    </Field>
  );
}

function PlacementChoice({
  label,
  align,
  vertical,
  color,
  disabled,
  onChange,
  t,
}: {
  label: string;
  align: ClipTextAlign;
  vertical: ClipTextVertical;
  color: string;
  disabled: boolean;
  onChange: (placement: { align: ClipTextAlign; vertical: ClipTextVertical }) => void;
  t: Translate;
}) {
  return (
    <Field label={label}>
      <div className="grid w-fit grid-cols-3 gap-1">
        {VERTICAL.flatMap((row) =>
          HORIZONTAL.map((column) => {
            const active = align === column && vertical === row;
            return (
              <GridButton
                key={`${row}-${column}`}
                label={`${t(`clips.editor.overlay.align.${row}`)} ${t(`clips.editor.overlay.align.${column}`)}`}
                active={active}
                disabled={disabled}
                onClick={() => onChange({ align: column, vertical: row })}
              >
                <span
                  className={cn("rounded-full", active ? "h-2 w-2" : "h-1 w-1 bg-white/40")}
                  style={active ? { backgroundColor: color } : undefined}
                />
              </GridButton>
            );
          }),
        )}
      </div>
    </Field>
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
    <aside className={CARD}>
      <PanelTitle color={accent}>{t("clips.editor.inspector")}</PanelTitle>
      <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden p-4">
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

            <p className="-mt-2 flex items-center gap-2 font-minecraft text-xs text-white/50">
              <Icon icon="solar:clock-circle-bold" className="h-3.5 w-3.5 shrink-0" />
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
                <Field label={t("clips.editor.overlay.text")}>
                  <SearchStyleInput
                    icon="solar:text-bold"
                    value={picked.content}
                    disabled={busy}
                    placeholder={t("clips.editor.overlay.text_placeholder")}
                    aria-label={t("clips.editor.overlay.text")}
                    className="min-w-0 text-sm"
                    onChange={(event) => editOverlay(chosen, { content: event.target.value })}
                  />
                  {picked.content.trim() === "" && (
                    <p className="flex items-start gap-1.5 font-minecraft text-xs leading-snug text-amber-300">
                      <Icon icon="solar:danger-triangle-bold" className="mt-px h-3.5 w-3.5 shrink-0" />
                      {t("clips.editor.overlay.text_empty")}
                    </p>
                  )}
                </Field>
                <PlacementChoice
                  label={t("clips.editor.overlay.align")}
                  align={picked.align}
                  vertical={picked.vertical}
                  color={accent}
                  disabled={busy}
                  onChange={(placement) => editOverlay(chosen, placement)}
                  t={t}
                />
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
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
