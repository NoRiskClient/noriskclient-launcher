import { parseAnimationFile } from "./parseAnimation";

import type {
  EmoteMeta,
  ParsedEmote,
  ParsedEmoteFile,
  ParticleKeyframe,
  SoundKeyframe,
} from "./types";

/**
 * Parse an emote `.animation.json` file.
 *
 * The bone tracks are parsed by the standard `parseAnimationFile`. This
 * function additionally extracts the emote-specific top-level keys per
 * animation:
 *
 *   - `disableOnMove`, `disableOnHit`           — interruption flags
 *   - `firstPerson`, `stayInFirstPerson`        — view flags (metadata only)
 *   - `immersiveCamera`                          — camera flag (metadata only)
 *   - `lockVanillaBones: { [bone]: boolean }`   — bone-by-bone vanilla lock map
 *   - `particle_effects: { [time]: ... }`       — single object OR array per time
 *   - `sound_effects:    { [time]: ... }`       — same shape
 *
 * Default values mirror `GeoEmoteParser.kt` — notably `disableOnHit` defaults
 * to `true` because most authored emotes assume combat interrupts them.
 */
export function parseEmoteFile(json: unknown): ParsedEmoteFile {
  const root = (json ?? {}) as {
    format_version?: string;
    animations?: Record<string, unknown>;
  };

  const animFile = parseAnimationFile(root);
  const emotes: ParsedEmote[] = [];

  const animationsRaw = root.animations ?? {};
  for (const [name, raw] of Object.entries(animationsRaw)) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const animation = animFile.animations.find((a) => a.name === name);
    if (!animation) continue;

    const meta: EmoteMeta = {
      disableOnMove: readBool(obj.disableOnMove, false),
      disableOnHit: readBool(obj.disableOnHit, true),
      firstPerson: readBool(obj.firstPerson, false),
      stayInFirstPerson: readBool(obj.stayInFirstPerson, false),
      immersiveCamera: readBool(obj.immersiveCamera, false),
      lockVanillaBones: parseLockMap(obj.lockVanillaBones),
      particleEffects: parseParticleEffects(obj.particle_effects),
      soundEffects: parseSoundEffects(obj.sound_effects),
    };

    emotes.push({
      id: name,
      displayName: name,
      meta,
      animation,
    });
  }

  return {
    formatVersion: animFile.formatVersion,
    emotes,
  };
}

/**
 * Parse a single emote out of a file by id. Convenience for callers that
 * already know the emote name.
 */
export function parseEmote(json: unknown, id: string): ParsedEmote | null {
  return parseEmoteFile(json).emotes.find((e) => e.id === id) ?? null;
}

function readBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    if (raw === "true") return true;
    if (raw === "false") return false;
  }
  return fallback;
}

function parseLockMap(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const [bone, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "boolean") out[bone] = value;
  }
  return out;
}

function parseParticleEffects(
  raw: unknown
): Record<number, ParticleKeyframe[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<number, ParticleKeyframe[]> = {};
  for (const [timeKey, value] of Object.entries(
    raw as Record<string, unknown>
  )) {
    const time = Number.parseFloat(timeKey);
    if (!Number.isFinite(time)) continue;
    const list = Array.isArray(value)
      ? value
          .map((v) => parseSingleParticle(v))
          .filter((v): v is ParticleKeyframe => v !== null)
      : (() => {
          const single = parseSingleParticle(value);
          return single ? [single] : [];
        })();
    if (list.length > 0) out[time] = list;
  }
  return out;
}

function parseSingleParticle(raw: unknown): ParticleKeyframe | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const effect = obj.effect;
  if (typeof effect !== "string" || effect.length === 0) return null;

  return {
    effectId: effect,
    locator: typeof obj.locator === "string" ? obj.locator : "",
    bindToActor: readBool(obj.bind_to_actor, true),
    preEffectScript:
      typeof obj.pre_effect_script === "string" && obj.pre_effect_script !== ""
        ? obj.pre_effect_script
        : undefined,
  };
}

function parseSoundEffects(raw: unknown): Record<number, SoundKeyframe[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<number, SoundKeyframe[]> = {};
  for (const [timeKey, value] of Object.entries(
    raw as Record<string, unknown>
  )) {
    const time = Number.parseFloat(timeKey);
    if (!Number.isFinite(time)) continue;
    const list = Array.isArray(value)
      ? value
          .map((v) => parseSingleSound(v))
          .filter((v): v is SoundKeyframe => v !== null)
      : (() => {
          const single = parseSingleSound(value);
          return single ? [single] : [];
        })();
    if (list.length > 0) out[time] = list;
  }
  return out;
}

function parseSingleSound(raw: unknown): SoundKeyframe | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const effect = obj.effect;
  if (typeof effect !== "string" || effect.length === 0) return null;

  return {
    soundId: effect,
    volume: typeof obj.volume === "number" ? obj.volume : 1.0,
    pitch: typeof obj.pitch === "number" ? obj.pitch : 1.0,
  };
}
