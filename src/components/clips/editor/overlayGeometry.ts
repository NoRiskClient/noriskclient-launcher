import type { ClipCorner } from "../../../services/clip-service";

export const REFERENCE_HEIGHT = 1080;

export const ARROW_HEAD_SHARE = 0.3;
export const ARROW_HEAD_PER_THICKNESS = 3;
export const ARROW_WING_SHARE = 0.6;

export const BLUR_PASSES = 3;

export function atReference(size: number): string {
  return `${(size * 100) / REFERENCE_HEIGHT}cqh`;
}

export function blurSigma(strength: number): number {
  const radius = Math.min(Math.max(Math.round(strength), 1), 64);
  return Math.sqrt((BLUR_PASSES * radius * (radius + 1)) / 3);
}

export interface ArrowShape {
  thickness: number;
  tail: [number, number];
  neck: [number, number];
  tip: [number, number];
  wings: [[number, number], [number, number]];
}

export function arrowShape(
  width: number,
  height: number,
  thickness: number,
  towards: ClipCorner,
): ArrowShape {
  const stroke = Math.min(Math.max(thickness, 1), width, height);
  const shorter = Math.min(width, height);
  const fullHead = Math.min(
    Math.max(shorter * ARROW_HEAD_SHARE, stroke * ARROW_HEAD_PER_THICKNESS),
    shorter / 2,
  );
  const wing = fullHead * ARROW_WING_SHARE;
  const runX = Math.max(width - 1 - wing, 0);
  const runY = Math.max(height - 1 - wing, 0);
  const length = Math.max(Math.hypot(runX, runY), 1);
  const head = Math.min(fullHead, length);
  const right = towards.endsWith("right");
  const bottom = towards.startsWith("bottom");
  const at = (alongX: number, alongY: number): [number, number] => [
    right ? alongX + 0.5 : width - 0.5 - alongX,
    bottom ? alongY + 0.5 : height - 0.5 - alongY,
  ];
  const [unitX, unitY] = [runX / length, runY / length];
  const [baseX, baseY] = [runX - unitX * head, runY - unitY * head];
  return {
    thickness: stroke,
    tail: at(0, 0),
    neck: at(baseX, baseY),
    tip: at(runX, runY),
    wings: [
      at(baseX + unitY * wing, baseY - unitX * wing),
      at(baseX - unitY * wing, baseY + unitX * wing),
    ],
  };
}
