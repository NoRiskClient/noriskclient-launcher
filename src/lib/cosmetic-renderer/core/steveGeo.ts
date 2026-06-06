import type { ParsedGeo } from "./types";

/**
 * Default Steve mannequin in Bedrock pixel coordinates.
 *
 * Mirrors the standard player rig so cosmetics that attach to `armor*` bones
 * and emotes that animate `biped*` bones can share the same skeleton with
 * consistent pivots.
 *
 * Three bone families:
 * - `bipedRig` — root anchor at the player's feet. Empty (no cubes), used
 *                only for whole-body translation/rotation; emotes animate
 *                this to move the entire player at once. All `biped*` body
 *                parts parent to this so animating it propagates to them.
 * - `biped*`   — carry the cube geometry (head, body, arms, legs).
 * - `armor*`   — empty transform anchors parented to the matching `biped*`.
 *                Cosmetics + emote props conventionally attach here so they
 *                inherit player motion without polluting the body bone.
 */
export const STEVE_GEO: ParsedGeo = {
  identifier: "geometry.steve",
  textureWidth: 64,
  textureHeight: 64,
  bones: [
    { name: "bipedRig", pivot: [0, 0, 0] },

    {
      name: "bipedHead",
      parent: "bipedRig",
      pivot: [0, 24, 0],
      cubes: [
        { origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] },
        { origin: [-4, 24, -4], size: [8, 8, 8], uv: [32, 0], inflate: 0.5 },
      ],
    },
    { name: "armorHead", parent: "bipedHead", pivot: [0, 24, 0] },

    {
      name: "bipedBody",
      parent: "bipedRig",
      pivot: [0, 24, 0],
      cubes: [
        { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] },
        { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 32], inflate: 0.25 },
      ],
    },
    { name: "armorBody", parent: "bipedBody", pivot: [0, 24, 0] },

    {
      name: "bipedRightArm",
      parent: "bipedRig",
      pivot: [-5, 22, 0],
      cubes: [
        { origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 16] },
        { origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 32], inflate: 0.25 },
      ],
    },
    { name: "armorRightArm", parent: "bipedRightArm", pivot: [-5, 22, 0] },

    {
      name: "bipedLeftArm",
      parent: "bipedRig",
      pivot: [5, 22, 0],
      cubes: [
        { origin: [4, 12, -2], size: [4, 12, 4], uv: [32, 48] },
        { origin: [4, 12, -2], size: [4, 12, 4], uv: [48, 48], inflate: 0.25 },
      ],
    },
    { name: "armorLeftArm", parent: "bipedLeftArm", pivot: [5, 22, 0] },

    {
      name: "bipedRightLeg",
      parent: "bipedRig",
      pivot: [-2, 12, 0],
      cubes: [
        { origin: [-4, 0, -2], size: [4, 12, 4], uv: [0, 16] },
        { origin: [-4, 0, -2], size: [4, 12, 4], uv: [0, 32], inflate: 0.25 },
      ],
    },
    { name: "armorRightLeg", parent: "bipedRightLeg", pivot: [-2, 12, 0] },
    { name: "armorRightBoot", parent: "bipedRightLeg", pivot: [-2, 12, 0] },

    {
      name: "bipedLeftLeg",
      parent: "bipedRig",
      pivot: [2, 12, 0],
      cubes: [
        { origin: [0, 0, -2], size: [4, 12, 4], uv: [16, 48] },
        { origin: [0, 0, -2], size: [4, 12, 4], uv: [0, 48], inflate: 0.25 },
      ],
    },
    { name: "armorLeftLeg", parent: "bipedLeftLeg", pivot: [2, 12, 0] },
    { name: "armorLeftBoot", parent: "bipedLeftLeg", pivot: [2, 12, 0] },
  ],
};

export const STEVE_SLIM_GEO: ParsedGeo = {
  ...STEVE_GEO,
  bones: STEVE_GEO.bones.map((bone) => {
    if (bone.name === "bipedRightArm") {
      return {
        ...bone,
        cubes: [
          { origin: [-7, 12, -2], size: [3, 12, 4], uv: [40, 16] },
          { origin: [-7, 12, -2], size: [3, 12, 4], uv: [40, 32], inflate: 0.25 },
        ],
      };
    }
    if (bone.name === "bipedLeftArm") {
      return {
        ...bone,
        cubes: [
          { origin: [4, 12, -2], size: [3, 12, 4], uv: [32, 48] },
          { origin: [4, 12, -2], size: [3, 12, 4], uv: [48, 48], inflate: 0.25 },
        ],
      };
    }
    return bone;
  }),
};

export type SteveModelVariant = "classic" | "slim";

export function steveGeoForVariant(variant: SteveModelVariant): ParsedGeo {
  return variant === "slim" ? STEVE_SLIM_GEO : STEVE_GEO;
}

/**
 * Render dimensions of the Steve rig.
 *
 * Origin sits at Steve's feet, top of head at y=32; world scale 1/22 lands
 * the model in roughly the same canvas footprint as the cosmetic preview
 * (which expects ~2.18 units of vertical extent at the default camera).
 */
export const STEVE_HEIGHT_PX = 32;
export const STEVE_WORLD_SCALE = 1 / 22;
