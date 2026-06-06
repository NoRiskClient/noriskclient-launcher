import { sampleAnimationChannel } from "./runtimeAnimation";

import type {
  ParsedEmote,
  ParticleKeyframe,
  SoundKeyframe,
} from "./types";

/**
 * Per-bone delta from one frame of animation. Position/rotation are summed
 * across active emotes (additive blend); scale multiplies as
 * `1 + (s - 1) * weight` so identity (1) stays a no-op.
 *
 * Rotations are kept in degrees (Bedrock convention). The downstream rig
 * applier converts to radians.
 */
export interface EmoteSnapshot {
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

export interface KeyframeListener {
  onParticleKeyframe?(
    emoteId: string,
    time: number,
    keyframe: ParticleKeyframe
  ): void;
  onSoundKeyframe?(
    emoteId: string,
    time: number,
    keyframe: SoundKeyframe
  ): void;
  /**
   * Fired when an emote naturally ends (non-looping animation reached its
   * length, or fade-out completed). Not fired when the emote is replaced by
   * a new `play()` of the same id.
   */
  onEmoteFinished?(emoteId: string): void;
}

export interface PlayEmoteOptions {
  /** Default 0.25s. Set 0 for an instant cut. */
  fadeInSeconds?: number;
  /**
   * Override the emote's authored loop flag.
   *
   * - `true`  → wrap to `t = elapsed % length`, plays forever
   * - `false` → emote ends after one length and fades out (or is removed)
   * - omitted → use whatever the parsed animation declared
   */
  loop?: boolean;
}

interface ActiveEmote {
  emote: ParsedEmote;
  /** Effective loop flag after applying any caller override. */
  loop: boolean;
  /** Wallclock seconds at which the emote was started. */
  startTime: number;
  /** Last `currentTime` we observed in `update()` — used to bracket keyframes. */
  lastTime: number;
  /** 0–1; 1 means "fully on". */
  blendWeight: number;
  fadeInSeconds: number;
  isFadingOut: boolean;
  fadeOutSeconds: number;
  fadeOutStartTime: number;
}

/**
 * Multi-emote scheduler.
 *
 * Mirrors the responsibilities of `GeoEmotePlayer.kt`: maintain a list of
 * active emotes, advance their animation time per frame, fire particle/sound
 * keyframes that crossed the elapsed window, expire finished emotes, and
 * combine all active bone tracks into a single per-bone snapshot via
 * additive blending.
 *
 * One `EmotePlayer` instance per "actor" (in the web preview that's just one
 * Steve rig; on a multiplayer client it would be one per player id).
 */
export class EmotePlayer {
  private active: ActiveEmote[] = [];
  private listener: KeyframeListener | null;

  constructor(opts?: { keyframeListener?: KeyframeListener }) {
    this.listener = opts?.keyframeListener ?? null;
  }

  setKeyframeListener(listener: KeyframeListener | null) {
    this.listener = listener;
  }

  /**
   * Start playing an emote. If an emote with the same id is already active
   * it is restarted (removed and re-added) — matches `GeoEmotePlayer.kt`.
   *
   * Pass `currentTime` so the player has a startTime reference; if omitted,
   * the next `update()` call will retroactively anchor it to whatever time
   * arrives there.
   */
  play(
    emote: ParsedEmote,
    currentTime: number,
    opts: PlayEmoteOptions = {}
  ): void {
    this.active = this.active.filter((a) => a.emote.id !== emote.id);
    const fadeInSeconds = opts.fadeInSeconds ?? 0.25;
    const loop = opts.loop ?? emote.animation.loop;
    this.active.push({
      emote,
      loop,
      startTime: currentTime,
      lastTime: currentTime,
      blendWeight: fadeInSeconds > 0 ? 0 : 1,
      fadeInSeconds,
      isFadingOut: false,
      fadeOutSeconds: 0,
      fadeOutStartTime: 0,
    });
  }

  /**
   * Stop a specific emote by id.
   *
   * `fadeOutSeconds = 0` removes immediately; positive values trigger an
   * additive fade-out that completes (and removes the emote) once weight
   * reaches 0.
   */
  stop(emoteId: string, fadeOutSeconds = 0, currentTime?: number): void {
    if (fadeOutSeconds <= 0) {
      this.active = this.active.filter((a) => a.emote.id !== emoteId);
      return;
    }
    for (const a of this.active) {
      if (a.emote.id === emoteId && !a.isFadingOut) {
        a.isFadingOut = true;
        a.fadeOutSeconds = fadeOutSeconds;
        a.fadeOutStartTime = currentTime ?? a.lastTime;
      }
    }
  }

  stopAll(fadeOutSeconds = 0, currentTime?: number): void {
    if (fadeOutSeconds <= 0) {
      this.active = [];
      return;
    }
    for (const a of this.active) {
      if (a.isFadingOut) continue;
      a.isFadingOut = true;
      a.fadeOutSeconds = fadeOutSeconds;
      a.fadeOutStartTime = currentTime ?? a.lastTime;
    }
  }

  isPlaying(emoteId?: string): boolean {
    if (emoteId === undefined) {
      return this.active.some((a) => !a.isFadingOut);
    }
    return this.active.some((a) => a.emote.id === emoteId && !a.isFadingOut);
  }

  hasActive(): boolean {
    return this.active.length > 0;
  }

  /** Snapshot of the current actives — for diagnostics, not for mutation. */
  getActiveEmoteIds(): string[] {
    return this.active.map((a) => a.emote.id);
  }

  /**
   * Advance all active emotes to `currentTime` (seconds). Updates fade
   * weights, fires keyframes that crossed since the last update, and removes
   * expired emotes.
   *
   * `isMoving` / `isHit` short-circuit interruption flags from the emote
   * meta — when a meta flag is set and the corresponding state is true, the
   * emote is removed immediately (no fade) and `onEmoteFinished` fires.
   */
  update(
    currentTime: number,
    opts: { isMoving?: boolean; isHit?: boolean } = {}
  ): void {
    const isMoving = opts.isMoving === true;
    const isHit = opts.isHit === true;

    const survivors: ActiveEmote[] = [];

    for (const a of this.active) {
      const meta = a.emote.meta;
      if ((meta.disableOnMove && isMoving) || (meta.disableOnHit && isHit)) {
        this.listener?.onEmoteFinished?.(a.emote.id);
        continue;
      }

      const previousAnimTime = animTimeFor(a, a.lastTime);
      const currentAnimTime = animTimeFor(a, currentTime);

      this.fireKeyframes(a, previousAnimTime, currentAnimTime);

      if (a.fadeInSeconds > 0 && !a.isFadingOut) {
        const elapsed = currentTime - a.startTime;
        a.blendWeight = clamp01(elapsed / a.fadeInSeconds);
      }

      if (a.isFadingOut) {
        const fadeProgress =
          a.fadeOutSeconds > 0
            ? clamp01((currentTime - a.fadeOutStartTime) / a.fadeOutSeconds)
            : 1;
        a.blendWeight = 1 - fadeProgress;
        if (fadeProgress >= 1) {
          this.listener?.onEmoteFinished?.(a.emote.id);
          continue;
        }
      }

      // Non-looping emotes self-expire when the underlying animation finishes.
      // We compare against raw elapsed (not wrapped time) so we correctly
      // catch the moment we run past `length`.
      const rawElapsed = currentTime - a.startTime;
      if (
        !a.loop &&
        a.emote.animation.length > 0 &&
        rawElapsed >= a.emote.animation.length &&
        !a.isFadingOut
      ) {
        this.listener?.onEmoteFinished?.(a.emote.id);
        continue;
      }

      a.lastTime = currentTime;
      survivors.push(a);
    }

    this.active = survivors;
  }

  /**
   * Combine all active bone tracks into a single snapshot map.
   *
   * - Position is summed across emotes, weighted by `blendWeight`.
   * - Rotation is summed (degrees), weighted.
   * - Scale uses `1 + (s - 1) * weight` so identity scales blend cleanly.
   *
   * The same logic as `GeoEmotePlayer.kt:computeCombinedBoneTransforms`.
   */
  getCombinedSnapshots(): Map<string, EmoteSnapshot> {
    const out = new Map<string, EmoteSnapshot>();
    if (this.active.length === 0) return out;

    for (const a of this.active) {
      const w = a.blendWeight;
      if (w <= 0) continue;
      const animTime = animTimeFor(a, a.lastTime);

      for (const [boneName, bone] of Object.entries(a.emote.animation.bones)) {
        let snapshot = out.get(boneName);
        if (!snapshot) {
          snapshot = createIdentitySnapshot();
          out.set(boneName, snapshot);
        }

        if (bone.position) {
          const v = sampleAnimationChannel(bone.position, animTime);
          snapshot.posX += v[0] * w;
          snapshot.posY += v[1] * w;
          snapshot.posZ += v[2] * w;
        }
        if (bone.rotation) {
          const v = sampleAnimationChannel(bone.rotation, animTime);
          snapshot.rotX += v[0] * w;
          snapshot.rotY += v[1] * w;
          snapshot.rotZ += v[2] * w;
        }
        if (bone.scale) {
          const v = sampleAnimationChannel(bone.scale, animTime);
          snapshot.scaleX *= 1 + (v[0] - 1) * w;
          snapshot.scaleY *= 1 + (v[1] - 1) * w;
          snapshot.scaleZ *= 1 + (v[2] - 1) * w;
        }
      }
    }

    return out;
  }

  /** Bone names locked by any active emote (`lockVanillaBones[bone] === true`). */
  getLockedBones(): Set<string> {
    const out = new Set<string>();
    for (const a of this.active) {
      for (const [bone, locked] of Object.entries(
        a.emote.meta.lockVanillaBones
      )) {
        if (locked) out.add(bone);
      }
    }
    return out;
  }

  private fireKeyframes(
    a: ActiveEmote,
    previousAnimTime: number,
    currentAnimTime: number
  ): void {
    const listener = this.listener;
    if (!listener) return;
    if (currentAnimTime <= previousAnimTime) return;

    const meta = a.emote.meta;

    if (listener.onParticleKeyframe) {
      for (const [timeKey, keyframes] of Object.entries(meta.particleEffects)) {
        const t = Number.parseFloat(timeKey);
        if (!Number.isFinite(t)) continue;
        if (t < previousAnimTime || t >= currentAnimTime) continue;
        for (const kf of keyframes) {
          listener.onParticleKeyframe(a.emote.id, t, kf);
        }
      }
    }

    if (listener.onSoundKeyframe) {
      for (const [timeKey, keyframes] of Object.entries(meta.soundEffects)) {
        const t = Number.parseFloat(timeKey);
        if (!Number.isFinite(t)) continue;
        if (t < previousAnimTime || t >= currentAnimTime) continue;
        for (const kf of keyframes) {
          listener.onSoundKeyframe(a.emote.id, t, kf);
        }
      }
    }
  }
}

function animTimeFor(a: ActiveEmote, currentTime: number): number {
  const elapsed = Math.max(0, currentTime - a.startTime);
  const length = a.emote.animation.length;
  if (!a.loop || length <= 0) return elapsed;
  return elapsed % length;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function createIdentitySnapshot(): EmoteSnapshot {
  return {
    posX: 0,
    posY: 0,
    posZ: 0,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
  };
}
