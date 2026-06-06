import * as THREE from "three";

import { evalMolang, type MolangContext } from "./molang";

import type {
  AnimationChannel,
  ParsedAnimation,
  ParsedAnimationFile,
  ParsedGeo,
  Vec3,
  Vec3Expr,
} from "./types";
import type { BoneTree } from "./buildBoneTree";

/**
 * Per-frame, live-evaluated animation.
 *
 * Why live instead of baking into a `THREE.AnimationClip`:
 *   Molang animations such as `math.sin(query.anim_time * 100)` are *procedural*
 *   — there's no real loop point in MC, `query.anim_time` just keeps growing.
 *   A baked clip has to wrap at some duration, and the values at the start vs.
 *   end of the wrap are different, so you get a visible "hak" every time the
 *   mixer loops. By re-evaluating Molang each frame at the actual elapsed time
 *   we sidestep the wrap entirely.
 *
 *   Non-Molang channels still loop cleanly via `t = elapsed % length`.
 */
export interface RuntimeAnimation {
  name: string;
  /** Loop length used for non-Molang channels (`elapsed % length`). */
  length: number;
  /** True when at least one channel evaluates Molang. */
  hasMolang: boolean;
  bones: RuntimeBoneAnim[];
}

interface RuntimeBoneAnim {
  bone: THREE.Group;
  /** Rest position of this bone in its parent's local space, sign-baked. */
  restPos: Vec3;
  position?: AnimationChannel;
  rotation?: AnimationChannel;
  scale?: AnimationChannel;
  /** Channel-level Molang flag, used to decide per-channel time wrap. */
  positionHasMolang: boolean;
  rotationHasMolang: boolean;
  scaleHasMolang: boolean;
}

export interface RuntimeAnimationOptions {
  /** Mirror animation deltas + rest pose on X to match `negateX` parsing. */
  negateX?: boolean;
}

const DEG_TO_RAD = Math.PI / 180;
const REUSED_EULER = new THREE.Euler(0, 0, 0, "ZYX");

export function buildRuntimeAnimations(
  parsed: ParsedAnimationFile,
  geo: ParsedGeo,
  tree: BoneTree,
  options: RuntimeAnimationOptions = {}
): RuntimeAnimation[] {
  const negateX = options.negateX ?? true;
  const restPoses = computeRestPoses(geo, negateX);

  const out: RuntimeAnimation[] = [];
  for (const anim of parsed.animations) {
    const bones: RuntimeBoneAnim[] = [];
    let hasMolang = false;

    for (const [boneName, boneAnim] of Object.entries(anim.bones)) {
      const boneGroup = tree.bones.get(boneName);
      if (!boneGroup) continue;
      const rest = restPoses.get(boneName) ?? [0, 0, 0];

      const positionHas = !!boneAnim.position?.hasExpression;
      const rotationHas = !!boneAnim.rotation?.hasExpression;
      const scaleHas = !!boneAnim.scale?.hasExpression;
      if (positionHas || rotationHas || scaleHas) hasMolang = true;

      bones.push({
        bone: boneGroup,
        restPos: rest,
        position: boneAnim.position,
        rotation: boneAnim.rotation,
        scale: boneAnim.scale,
        positionHasMolang: positionHas,
        rotationHasMolang: rotationHas,
        scaleHasMolang: scaleHas,
      });
    }

    if (bones.length === 0) continue;
    out.push({ name: anim.name, length: anim.length, hasMolang, bones });
  }
  return out;
}

/**
 * Apply a runtime animation to its bound bones at the given elapsed time
 * (seconds since the cosmetic was first rendered — *not* a wrapped clip time).
 */
export function applyRuntimeAnimation(
  anim: RuntimeAnimation,
  elapsedSeconds: number,
  options: RuntimeAnimationOptions = {}
) {
  const negateX = options.negateX ?? true;

  // Non-Molang channels loop cleanly at `length`. Molang channels read the raw
  // elapsed time so `query.anim_time` matches MC.
  const wrappedT = anim.length > 0 ? elapsedSeconds % anim.length : elapsedSeconds;

  for (const ba of anim.bones) {
    if (ba.position) {
      const v = sampleVec3(
        ba.position,
        wrappedT,
        ba.positionHasMolang ? elapsedSeconds : wrappedT
      );
      ba.bone.position.set(
        negateX ? ba.restPos[0] - v[0] : ba.restPos[0] + v[0],
        ba.restPos[1] + v[1],
        ba.restPos[2] + v[2]
      );
    }
    if (ba.rotation) {
      const v = sampleVec3(
        ba.rotation,
        wrappedT,
        ba.rotationHasMolang ? elapsedSeconds : wrappedT
      );
      const rx = negateX ? -v[0] : v[0];
      const ry = negateX ? -v[1] : v[1];
      const rz = v[2];
      REUSED_EULER.set(rx * DEG_TO_RAD, ry * DEG_TO_RAD, rz * DEG_TO_RAD, "ZYX");
      ba.bone.quaternion.setFromEuler(REUSED_EULER);
    }
    if (ba.scale) {
      const v = sampleVec3(
        ba.scale,
        wrappedT,
        ba.scaleHasMolang ? elapsedSeconds : wrappedT
      );
      ba.bone.scale.set(v[0], v[1], v[2]);
    }
  }
}

function computeRestPoses(geo: ParsedGeo, negateX: boolean): Map<string, Vec3> {
  const map = new Map<string, Vec3>();
  const byName = new Map(geo.bones.map((b) => [b.name, b]));
  for (const b of geo.bones) {
    const pivot = b.pivot ?? [0, 0, 0];
    const parent = b.parent ? byName.get(b.parent) : undefined;
    const parentPivot = parent?.pivot ?? [0, 0, 0];
    const pivotX = negateX ? -pivot[0] : pivot[0];
    const parentPivotX = negateX ? -parentPivot[0] : parentPivot[0];
    map.set(b.name, [
      pivotX - parentPivotX,
      pivot[1] - parentPivot[1],
      pivot[2] - parentPivot[2],
    ]);
  }
  return map;
}

/**
 * Sample a parsed animation channel at time `t` (seconds), returning the
 * interpolated `[x, y, z]` value. Linear lerp between neighbouring keyframes,
 * clamped at the endpoints. Molang strings are evaluated with `t` substituted
 * into `query.anim_time`.
 *
 * Exposed for `EmotePlayer.getCombinedSnapshots()` so emotes can sample bones
 * without re-implementing the same keyframe walk.
 */
export function sampleAnimationChannel(channel: AnimationChannel, t: number): Vec3 {
  return sampleVec3(channel, t);
}

function sampleVec3(
  channel: AnimationChannel,
  t: number,
  expressionTime = t
): Vec3 {
  const kf = channel.keyframes;
  if (kf.length === 0) return [0, 0, 0];
  if (kf.length === 1 || t <= kf[0].time) {
    return evalVec3(kf[0].post, expressionTime);
  }
  if (t >= kf[kf.length - 1].time) {
    return evalVec3(kf[kf.length - 1].post, expressionTime);
  }

  for (let i = 0; i < kf.length - 1; i++) {
    const k0 = kf[i];
    const k1 = kf[i + 1];
    if (t >= k0.time && t <= k1.time) {
      const span = k1.time - k0.time;
      const u = span === 0 ? 0 : (t - k0.time) / span;
      const a = evalVec3(k0.post, expressionTime);
      const b = evalVec3(k1.pre, expressionTime);
      return [
        a[0] + (b[0] - a[0]) * u,
        a[1] + (b[1] - a[1]) * u,
        a[2] + (b[2] - a[2]) * u,
      ];
    }
  }
  return evalVec3(kf[kf.length - 1].post, expressionTime);
}

function evalVec3(v: Vec3Expr, t: number): Vec3 {
  const ctx: MolangContext = { animTime: t };
  return [
    typeof v[0] === "number" ? v[0] : evalMolang(v[0], ctx),
    typeof v[1] === "number" ? v[1] : evalMolang(v[1], ctx),
    typeof v[2] === "number" ? v[2] : evalMolang(v[2], ctx),
  ];
}
