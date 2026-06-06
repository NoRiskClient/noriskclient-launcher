import * as THREE from "three";

import type { LoadedCosmetic } from "./loadCosmetic";

/**
 * Bones that receive `cosmetic.scale` per-bone in MC's gameplay path. Mirrors
 * `BodyPartUtil.BODY_PART_MAPPINGS` (the only bones the in-game renderer
 * scales individually — biped* and other transform-only bones are left
 * untouched so the player skeleton stays correct).
 */
const ARMOR_BONE_NAMES = [
  "armorHead",
  "armorBody",
  "armorLeftArm",
  "armorRightArm",
  "armorLeftArmSlim",
  "armorRightArmSlim",
  "armorLeftLeg",
  "armorRightLeg",
  "armorLeftBoot",
  "armorRightBoot",
] as const;

/**
 * Apply MC's gameplay `cosmetic.scale` + `cosmetic.offset` to the cosmetic
 * tree, in place.
 *
 * Why per-bone (not on a wrapper group): MC's `GeoCosmeticRenderer.kt:197-205`
 * does `bone.scaleX *= cosmetic.scale` for each BODY_PART_MAPPINGS bone. The
 * scale is applied AT the armor bone's pivot — i.e., scaling around
 * `armorBody.pivot = (0, 24, 0)`. A cosmeticGroup wrapper around the whole
 * tree scales around world origin instead, which mis-positions every bone
 * with a non-1.0 scale.
 *
 * Concretely, for `gold_katana` (`scale = 0.4`):
 *   - Wrapper-scale (wrong): `S(0.4) × T(0,24,0) × …` → bipedBody anchor lands at
 *     world (0, 9.6, 0) instead of (0, 24, 0); content drops 60% toward floor.
 *   - Per-bone (correct): `T(0,24,0) × S(0.4) × T(-(0,24,0)) × …` → bipedBody
 *     stays at (0, 24, 0); only the armor content shrinks toward its pivot.
 *
 * Same per-bone treatment for `cosmetic.offset` (mirrors
 * `renderArmorBoneWithLocalOffset`'s `translate(offset/16)` between scale and
 * pivot-back). Offset is in pixel coords — the surrounding wrap converts
 * pixels→blocks.
 */
export function applyCosmeticTransform(loaded: LoadedCosmetic): void {
  const ds = loaded.meta.defaultSettings;
  const scale = ds.scale ?? 1;
  const [ox, oy, oz] = ds.offset;
  const hasOffset = ox !== 0 || oy !== 0 || oz !== 0;

  for (const name of ARMOR_BONE_NAMES) {
    const bone = loaded.tree.bones.get(name);
    if (!bone) continue;

    if (scale !== 1) {
      bone.scale.setScalar(scale);
    }

    // Wrap existing children in an offset group. Children include the bone's
    // own cube meshes plus any child bone groups (the actual cosmetic content
    // typically lives as a child bone of armorBody). Putting it INSIDE the
    // bone group means the offset gets applied after R × S in world frame,
    // matching MC's matrix order `R × S × T(offset) × T(-pivot)`.
    if (hasOffset && bone.children.length > 0) {
      const offsetGroup = new THREE.Group();
      offsetGroup.name = `${name}__offset`;
      offsetGroup.position.set(ox, oy, oz);
      const children = [...bone.children];
      for (const child of children) {
        bone.remove(child);
        offsetGroup.add(child);
      }
      bone.add(offsetGroup);
    }
  }
}
