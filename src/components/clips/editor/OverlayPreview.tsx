"use client";

import type { ClipOverlay } from "../../../services/clip-service";
import { cn } from "../../../lib/utils";
import { grey } from "./shared";

const REFERENCE_HEIGHT = 1080;
const BOX_BLUR_SIGMA = 0.577;

function atReference(size: number): string {
  return `${(size * 100) / REFERENCE_HEIGHT}cqh`;
}

function OverlayArt({ overlay, ratio }: { overlay: ClipOverlay; ratio: number }) {
  if (overlay.kind === "box") {
    return (
      <span
        className="pointer-events-none absolute inset-0"
        style={{ backgroundColor: grey(overlay.colour) }}
      />
    );
  }

  const width = Math.max(1, overlay.width * REFERENCE_HEIGHT * ratio);
  const height = Math.max(1, overlay.height * REFERENCE_HEIGHT);

  if (overlay.kind === "arrow") {
    const thickness = Math.min(Math.max(overlay.thickness, 1), width, height);
    const shorter = Math.min(width, height);
    const fullHead = Math.min(Math.max(shorter * 0.3, thickness * 3), shorter / 2);
    const wing = fullHead * 0.6;
    const runX = Math.max(width - wing, 0);
    const runY = Math.max(height - wing, 0);
    const length = Math.max(Math.hypot(runX, runY), 1);
    const head = Math.min(fullHead, length);
    const right = overlay.towards.endsWith("right");
    const bottom = overlay.towards.startsWith("bottom");
    const x = (along: number) => (right ? along : width - along);
    const y = (along: number) => (bottom ? along : height - along);
    const [unitX, unitY] = [runX / length, runY / length];
    const [baseX, baseY] = [runX - unitX * head, runY - unitY * head];
    const tip = `${x(runX)},${y(runY)}`;
    const left = `${x(baseX + unitY * wing)},${y(baseY - unitX * wing)}`;
    const rightWing = `${x(baseX - unitY * wing)},${y(baseY + unitX * wing)}`;
    const colour = grey(overlay.colour);
    return (
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <line
          x1={x(0)}
          y1={y(0)}
          x2={x(baseX)}
          y2={y(baseY)}
          stroke={colour}
          strokeWidth={thickness}
        />
        <polygon points={`${tip} ${left} ${rightWing}`} fill={colour} />
      </svg>
    );
  }

  if (overlay.kind === "text" && overlay.content.trim() !== "") {
    return (
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-all"
        style={{
          color: grey(overlay.colour),
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
  onPick,
  onGrab,
}: {
  overlay: ClipOverlay;
  ratio: number;
  active: boolean;
  visible: boolean;
  color: string;
  label: string;
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
        "absolute cursor-move rounded-sm border-2 transition-colors focus:outline-none",
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
            ? `blur(calc(${overlay.strength * BOX_BLUR_SIGMA} * ${atReference(1)}))`
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
          onGrab("resize", event);
        }}
        className="absolute -bottom-1 -right-1 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border border-black/50"
        style={{ backgroundColor: active ? color : "rgba(255, 255, 255, 0.7)" }}
      />
    </div>
  );
}
