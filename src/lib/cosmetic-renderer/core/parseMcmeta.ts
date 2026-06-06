import type { TextureAnimationInfo } from "./types";

/**
 * Parse a `.png.mcmeta` payload into a normalised TextureAnimationInfo.
 * Returns `null` for empty / non-animation files.
 *
 * Tolerates the `nrc.capeType` extension used by NoRiskClient assets — we
 * just ignore it; only the standard MC `animation` block matters for rendering.
 */
export function parseMcmeta(json: unknown): TextureAnimationInfo | null {
  if (!json || typeof json !== "object") return null;
  const a = (json as { animation?: unknown }).animation;
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;

  const frametime =
    typeof o.frametime === "number" && o.frametime > 0
      ? Math.floor(o.frametime)
      : 1;
  const interpolate = o.interpolate === true;
  const frameWidth = typeof o.width === "number" ? o.width : undefined;
  const frameHeight = typeof o.height === "number" ? o.height : undefined;

  let frames: number[] | undefined;
  if (Array.isArray(o.frames)) {
    const plain = o.frames.filter((f): f is number => typeof f === "number");
    if (plain.length > 0) frames = plain;
  }

  return { frameWidth, frameHeight, frametime, interpolate, frames };
}
