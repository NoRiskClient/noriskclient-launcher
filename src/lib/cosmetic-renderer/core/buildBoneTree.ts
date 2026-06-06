import * as THREE from "three";

import { buildCubeGeometry } from "./buildCubeGeometry";

import type { BedrockBone, BedrockCube, ParsedGeo, Vec3 } from "./types";

export interface BoneTree {
  /** Root container holding all top-level bones. */
  root: THREE.Group;
  /** bone name → its Group, for animation binding. */
  bones: Map<string, THREE.Group>;
  /** Rest-pose Euler rotation per bone (animations replace this when present). */
  defaultRotations: Map<string, THREE.Euler>;
}

export interface BuildBoneTreeOptions {
  /**
   * When true (default), only attach cube geometry to bones whose names start
   * with `armor*` (or are descendants of such a bone). This matches the
   * reference's `findAndRenderArmorBones` filter — non-armor bones like
   * `bipedHead`, `bipedBody`, `bb_main` are kept as transform-only anchors
   * but their cubes (typically Steve-skin preview boxes baked into the geo
   * by the cosmetic author) aren't rendered.
   */
  armorOnly?: boolean;
  /**
   * NRC cosmetics are authored in V2 LER-scaled space. With `negateX: true`
   * (default) we mirror geometry/pivots/rotations on X at parse time, matching
   * the reference's `GeoModelParser.parse(geometry, negateX = true)`.
   * Disable for cosmetics already authored in identity space.
   */
  negateX?: boolean;
}

/**
 * Walk parsed Bedrock bones and build a THREE.Group hierarchy.
 *
 * - Each bone becomes a `THREE.Group` whose `position` is `bone.pivot - parent.pivot`.
 * - Cubes are attached as children of their owning bone, with a per-cube pivot
 *   group when the cube declares its own rotation/pivot.
 * - Default `rotation` from the .geo.json is applied so the rest pose looks right
 *   in the absence of an animation; animations can later overwrite the bone's
 *   rotation track.
 * - When `armorOnly` is true, cubes outside the armor-bone subtree are skipped
 *   to avoid rendering preview-Steve geometry the cosmetic author baked in.
 */
export function buildBoneTree(
  geo: ParsedGeo,
  material: THREE.Material,
  options: BuildBoneTreeOptions = {}
): BoneTree {
  const armorOnly = options.armorOnly ?? true;
  const negateX = options.negateX ?? true;

  const boneByName = new Map<string, BedrockBone>();
  for (const b of geo.bones) boneByName.set(b.name, b);

  const renderableBones = computeRenderableBones(geo, armorOnly);

  const groups = new Map<string, THREE.Group>();
  const defaultRotations = new Map<string, THREE.Euler>();

  for (const b of geo.bones) {
    const g = new THREE.Group();
    g.name = b.name;
    groups.set(b.name, g);
  }

  for (const b of geo.bones) {
    const g = groups.get(b.name)!;
    const pivot: Vec3 = b.pivot ?? [0, 0, 0];

    let parentPivot: Vec3 = [0, 0, 0];
    if (b.parent) {
      const parentBone = boneByName.get(b.parent);
      if (parentBone?.pivot) parentPivot = parentBone.pivot;
    }

    const pivotX = negateX ? -pivot[0] : pivot[0];
    const parentPivotX = negateX ? -parentPivot[0] : parentPivot[0];

    g.position.set(
      pivotX - parentPivotX,
      pivot[1] - parentPivot[1],
      pivot[2] - parentPivot[2]
    );

    if (b.rotation) {
      // ZYX order matches GeckoLib reference (GeoBone.applyTransform:
      // matrix = Rz * Ry * Rx). Critical for bones with multi-axis rotations
      // like wings' `anglewing` [90, -75, -90].
      const rx = negateX ? -b.rotation[0] : b.rotation[0];
      const ry = negateX ? -b.rotation[1] : b.rotation[1];
      const rz = b.rotation[2];
      const euler = new THREE.Euler(
        THREE.MathUtils.degToRad(rx),
        THREE.MathUtils.degToRad(ry),
        THREE.MathUtils.degToRad(rz),
        "ZYX"
      );
      g.rotation.copy(euler);
      defaultRotations.set(b.name, euler.clone());
    } else {
      defaultRotations.set(b.name, new THREE.Euler(0, 0, 0, "ZYX"));
    }

    if (b.parent && groups.has(b.parent)) {
      groups.get(b.parent)!.add(g);
    }

    if (b.cubes && renderableBones.has(b.name)) {
      for (const cube of b.cubes) {
        g.add(buildCubeMesh(cube, pivot, geo, material, negateX));
      }
    }
  }

  const root = new THREE.Group();
  root.name = "cosmetic_root";
  for (const b of geo.bones) {
    if (!b.parent || !groups.has(b.parent)) {
      root.add(groups.get(b.name)!);
    }
  }

  return { root, bones: groups, defaultRotations };
}

/**
 * Compute the set of bones whose cubes should actually render. With
 * `armorOnly`, only bones that are an `armor*` bone or descend from one
 * qualify — Bedrock cosmetic geo files conventionally bake `bb_main` Steve
 * preview cubes plus structural `biped*` placeholders that the in-game
 * renderer also skips (see `GeoCosmeticRenderer.findAndRenderArmorBones`).
 */
function computeRenderableBones(geo: ParsedGeo, armorOnly: boolean): Set<string> {
  const result = new Set<string>();
  if (!armorOnly) {
    for (const b of geo.bones) result.add(b.name);
    return result;
  }

  const childrenByParent = new Map<string, string[]>();
  for (const b of geo.bones) {
    if (b.parent) {
      const list = childrenByParent.get(b.parent) ?? [];
      list.push(b.name);
      childrenByParent.set(b.parent, list);
    }
  }

  function markSubtree(name: string) {
    if (result.has(name)) return;
    result.add(name);
    const children = childrenByParent.get(name);
    if (!children) return;
    for (const child of children) markSubtree(child);
  }

  for (const b of geo.bones) {
    if (b.name.toLowerCase().startsWith("armor")) markSubtree(b.name);
  }
  return result;
}

function buildCubeMesh(
  cube: BedrockCube,
  parentBonePivot: Vec3,
  geo: ParsedGeo,
  material: THREE.Material,
  negateX: boolean
): THREE.Object3D {
  // buildCubeGeometry already X-negates the cube origin/size internally.
  const geometry = buildCubeGeometry(cube, geo, { negateX });
  const hasPivot = cube.pivot !== undefined;
  const rot = cube.rotation;
  const hasRotation = !!rot && (rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0);

  const parentPivotX = negateX ? -parentBonePivot[0] : parentBonePivot[0];

  if (!hasPivot && !hasRotation) {
    geometry.translate(-parentPivotX, -parentBonePivot[1], -parentBonePivot[2]);
    return new THREE.Mesh(geometry, material);
  }

  const cubePivot: Vec3 = cube.pivot ?? [0, 0, 0];
  const cubePivotX = negateX ? -cubePivot[0] : cubePivot[0];

  geometry.translate(-cubePivotX, -cubePivot[1], -cubePivot[2]);
  const mesh = new THREE.Mesh(geometry, material);

  const pivotGroup = new THREE.Group();
  pivotGroup.position.set(
    cubePivotX - parentPivotX,
    cubePivot[1] - parentBonePivot[1],
    cubePivot[2] - parentBonePivot[2]
  );
  if (hasRotation && rot) {
    // ZYX matches GeckoLib reference (GeoCube.render: rotateZ → rotateY → rotateX
    // applied via post-mult on the matrix stack = Rz*Ry*Rx).
    const rx = negateX ? -rot[0] : rot[0];
    const ry = negateX ? -rot[1] : rot[1];
    const rz = rot[2];
    pivotGroup.rotation.set(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz),
      "ZYX"
    );
  }
  pivotGroup.add(mesh);
  return pivotGroup;
}
