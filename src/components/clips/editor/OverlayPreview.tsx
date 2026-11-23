"use client";

import type { ClipOverlay, ClipTextVertical } from "../../../services/clip-service";
import { cn } from "../../../lib/utils";
import { toHex } from "./shared";
import { holdPointer } from "./useWindowDrag";
import { REFERENCE_HEIGHT, arrowShape, atReference, blurSigma } from "./overlayGeometry";

const JUSTIFY: Record<ClipTextVertical, string> = {
  top: "justify-start",
  center: "justify-center",
  bottom: "justify-end",
};

function OverlayArt({ overlay, ratio }: { overlay: ClipOverlay; ratio: number }) {
  if (overlay.kind === "box") {
    return (
      <span
        className="pointer-events-none absolute inset-0"
        style={{ backgroundColor: toHex(overlay.colour) }}
      />
    );
  }

  const width = Math.max(1, overlay.width * REFERENCE_HEIGHT * ratio);
  const height = Math.max(1, overlay.height * REFERENCE_HEIGHT);

  if (overlay.kind === "arrow") {
    const arrow = arrowShape(width, height, overlay.thickness, overlay.towards);
    const point = ([x, y]: [number, number]) => `${x},${y}`;
    const colour = toHex(overlay.colour);
    return (
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <line
          x1={arrow.tail[0]}
          y1={arrow.tail[1]}
          x2={arrow.neck[0]}
          y2={arrow.neck[1]}
          stroke={colour}
          strokeWidth={arrow.thickness}
        />
        <polygon
          points={`${point(arrow.tip)} ${point(arrow.wings[0])} ${point(arrow.wings[1])}`}
          fill={colour}
        />
      </svg>
    );
  }

  if (overlay.kind === "text" && overlay.content.trim() !== "") {
    return (
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 flex flex-col overflow-hidden whitespace-pre-wrap break-all",
          JUSTIFY[overlay.vertical],
        )}
        style={{
          textAlign: overlay.align,
          color: toHex(overlay.colour),
          fontFamily: "SmallCaps, monospace",
          fontSize: atReference(overlay.size),
          letterSpacing: "normal",
          lineHeight: 1,
        }}
      >
        {overlay.content.trim()}
      </div>
    );
  }

  return null;
}

export function OverlayBox({
  overlay,
  ratio,
  active,
  visible,
  color,
  label,
  disabled,
  onPick,
  onGrab,
}: {
  overlay: ClipOverlay;
  ratio: number;
  active: boolean;
  visible: boolean;
  color: string;
  label: string;
  disabled: boolean;
  onPick: () => void;
  onGrab: (mode: "move" | "resize", event: { clientX: number; clientY: number }) => void;
}) {
  const blank = overlay.kind === "text" && overlay.content.trim() === "";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={active}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (disabled) return;
        holdPointer(event);
        onGrab("move", event);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onPick();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onPick();
      }}
      className={cn(
        "absolute rounded-sm border-2 transition-colors focus:outline-none",
        disabled ? "cursor-not-allowed" : "cursor-move",
        active ? "bg-white/5" : "border-white/40 bg-black/10 hover:border-white/70",
        blank && "border-dashed",
        !visible && "opacity-40",
      )}
      style={{
        left: `${overlay.left * 100}%`,
        top: `${overlay.top * 100}%`,
        width: `${overlay.width * 100}%`,
        height: `${overlay.height * 100}%`,
        backdropFilter:
          overlay.kind === "blur"
            ? `blur(calc(${blurSigma(overlay.strength)} * ${atReference(1)}))`
            : undefined,
        borderColor: blank ? "#fcd34d" : active ? color : undefined,
        boxShadow: active ? `0 0 10px ${color}80` : undefined,
      }}
    >
      <OverlayArt overlay={overlay} ratio={ratio} />

      <span
        role="presentation"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (disabled) return;
          holdPointer(event);
          onGrab("resize", event);
        }}
        className={cn(
          "absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-sm border border-black/50",
          !disabled && "cursor-nwse-resize",
        )}
        style={{ backgroundColor: active ? color : "rgba(255, 255, 255, 0.7)" }}
      />
    </div>
  );
}
