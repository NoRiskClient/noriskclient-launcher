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

const HEADING: Record<ClipCorner, [number, number]> = {
  top_left: [-1, -1],
  top_right: [1, -1],
  bottom_left: [-1, 1],
  bottom_right: [1, 1],
  top: [0, -1],
  right: [1, 0],
  bottom: [0, 1],
  left: [-1, 0],
};

function ends(size: number, way: number, wing: number): [number, number] {
  const last = size - 1;
  if (way > 0) return [0, Math.max(last - wing, 0)];
  if (way < 0) return [last, Math.min(wing, last)];
  return [last / 2, last / 2];
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
  const [wayX, wayY] = HEADING[towards];
  const [tailX, tipX] = ends(width, wayX, wing);
  const [tailY, tipY] = ends(height, wayY, wing);
  const [runX, runY] = [tipX - tailX, tipY - tailY];
  const length = Math.max(Math.hypot(runX, runY), 1);
  const head = Math.min(fullHead, length);
  const [unitX, unitY] = [runX / length, runY / length];
  const [neckX, neckY] = [tipX - unitX * head, tipY - unitY * head];
  const at = (x: number, y: number): [number, number] => [x + 0.5, y + 0.5];
  return {
    thickness: stroke,
    tail: at(tailX, tailY),
    neck: at(neckX, neckY),
    tip: at(tipX, tipY),
    wings: [
      at(neckX + unitY * wing, neckY - unitX * wing),
      at(neckX - unitY * wing, neckY + unitX * wing),
    ],
  };
}
