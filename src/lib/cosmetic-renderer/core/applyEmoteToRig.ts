import * as THREE from "three";

import type { EmotePlayer, EmoteSnapshot } from "./emotePlayer";
import type { BoneTree } from "./buildBoneTree";

const DEG_TO_RAD = Math.PI / 180;

export interface ApplyEmoteOptions {
  /**
   * Match the rig's negateX so emote rotations land in the same coord space
   * as the BoneTree was built in. Default true (NRC convention).
   */
  negateX?: boolean;
  /**
   * Optional second BoneTree for prop bones (e.g. `gamerchair` in the gaming
   * chair emote). Bones in the snapshot map that don't exist on the rig but
   * do exist on the prop tree get the same delta treatment.
   */
  propTree?: BoneTree;
}

interface BoneRestPose {
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
}

interface RigState {
  /** Lazy-captured rest poses for every bone we've ever written to. */
  rest: Map<string, BoneRestPose>;
  /** Bones the previous frame wrote into; used to reset on deactivate. */
  lastTouched: Set<string>;
  /** The propTree we last knew about — invalidates rest cache when swapped. */
  propTree: BoneTree | null;
}

const stateByRig = new WeakMap<BoneTree, RigState>();
const REUSED_EULER = new THREE.Euler(0, 0, 0, "ZYX");

/**
 * Per-frame writer: pulls combined snapshots out of the `EmotePlayer` and
 * applies them to a Steve `BoneTree` plus an optional prop `BoneTree`.
 *
 * Convention matches `applyRuntimeAnimation`:
 *   - X position gets sign-flipped when `negateX` is true.
 *   - X and Y rotations get sign-flipped when `negateX` is true.
 *   - Rotations are degrees in the snapshot, radians on the THREE.Group.
 *
 * Bones that were animated last frame but aren't in this frame's snapshot
 * (e.g. an emote faded out) are reset to their captured rest pose, so a
 * stopped emote doesn't leave bones frozen mid-pose.
 */
export function applyEmoteToRig(
  player: EmotePlayer,
  rigTree: BoneTree,
  options: ApplyEmoteOptions = {}
): void {
  const negateX = options.negateX ?? true;
  const propTree = options.propTree ?? null;

  let state = stateByRig.get(rigTree);
  if (!state) {
    state = { rest: new Map(), lastTouched: new Set(), propTree: null };
    stateByRig.set(rigTree, state);
  }
  if (state.propTree !== propTree) {
    state.rest.clear();
    state.lastTouched.clear();
    state.propTree = propTree;
  }

  const snapshots = player.getCombinedSnapshots();
  const touchedThisFrame = new Set<string>();

  // Apply the same snapshot to BOTH trees when they share a bone name
  // (e.g. `bipedBody` exists on Steve AND on the prop's geo). The prop is
  // rendered as a sibling of Steve at world origin, so its own biped* bones
  // need to animate independently in sync — otherwise prop-anchored geo
  // (scooter under armorBody) wouldn't follow Steve's body.
  for (const [boneName, snapshot] of snapshots) {
    const rigGroup = rigTree.bones.get(boneName);
    const propGroup = propTree?.bones.get(boneName);
    if (!rigGroup && !propGroup) continue;
    if (rigGroup) {
      writeBoneFromSnapshot(rigGroup, rigKey(boneName), snapshot, state, negateX);
    }
    if (propGroup) {
      writeBoneFromSnapshot(propGroup, propKey(boneName), snapshot, state, negateX);
    }
    touchedThisFrame.add(boneName);
  }

  // Reset bones touched last frame but not this one — prevents fade-out
  // residue from sticking on the rig.
  for (const boneName of state.lastTouched) {
    if (touchedThisFrame.has(boneName)) continue;
    resetBone(rigTree.bones.get(boneName), rigKey(boneName), state);
    if (propTree) {
      resetBone(propTree.bones.get(boneName), propKey(boneName), state);
    }
  }

  state.lastTouched = touchedThisFrame;
}

/** Namespaced state key so rig and prop bones with the same name don't share rest poses. */
function rigKey(name: string): string {
  return `rig:${name}`;
}
function propKey(name: string): string {
  return `prop:${name}`;
}

function resetBone(
  group: THREE.Group | undefined,
  stateKey: string,
  state: RigState
): void {
  if (!group) return;
  const rest = state.rest.get(stateKey);
  if (!rest) return;
  group.position.set(rest.posX, rest.posY, rest.posZ);
  REUSED_EULER.set(rest.rotX, rest.rotY, rest.rotZ, "ZYX");
  group.quaternion.setFromEuler(REUSED_EULER);
  group.scale.set(1, 1, 1);
}

function writeBoneFromSnapshot(
  group: THREE.Group,
  boneName: string,
  snapshot: EmoteSnapshot,
  state: RigState,
  negateX: boolean
): void {
  let rest = state.rest.get(boneName);
  if (!rest) {
    rest = {
      posX: group.position.x,
      posY: group.position.y,
      posZ: group.position.z,
      rotX: group.rotation.x,
      rotY: group.rotation.y,
      rotZ: group.rotation.z,
    };
    state.rest.set(boneName, rest);
  }

  const dPosX = negateX ? -snapshot.posX : snapshot.posX;
  group.position.set(rest.posX + dPosX, rest.posY + snapshot.posY, rest.posZ + snapshot.posZ);

  const dRotX = (negateX ? -snapshot.rotX : snapshot.rotX) * DEG_TO_RAD;
  const dRotY = (negateX ? -snapshot.rotY : snapshot.rotY) * DEG_TO_RAD;
  const dRotZ = snapshot.rotZ * DEG_TO_RAD;
  REUSED_EULER.set(rest.rotX + dRotX, rest.rotY + dRotY, rest.rotZ + dRotZ, "ZYX");
  group.quaternion.setFromEuler(REUSED_EULER);

  group.scale.set(snapshot.scaleX, snapshot.scaleY, snapshot.scaleZ);
}

/**
 * Forget the rest-pose cache for a rig. Call this if you've manually moved
 * the rig's bones (e.g. between scenes) and want the next emote frame to
 * recapture rest poses from whatever is current.
 */
export function resetEmoteRigCache(rigTree: BoneTree): void {
  stateByRig.delete(rigTree);
}
