import type { ParsedGeo } from "./types";

/**
 * Hardcoded fallback geometry for CAPE cosmetics.
 *
 * Capes in nrc-assets ship as `.png` + `.png.mcmeta` only — no `.geo.json` —
 * because MC reuses the vanilla `PlayerCapeModel` for all of them. We mirror
 * that model here in Bedrock format so our generic `loadCosmetic` pipeline
 * can render them.
 *
 * Sources of the cube/pivot values:
 *   - `net.minecraft.client.model.player.PlayerCapeModel.createCapeLayer`
 *     (MC 1.21.11): `addBox(-5, 0, -1, 10, 16, 1, NONE, scaleU=1, scaleV=0.5)`
 *     attached to `body` at `offsetAndRotation(0, 0, 2, 0, π, 0)`.
 *   - `software.bernie.geckolib.mixin.client.NrcCapeModelMixin`: NRC overrides
 *     the layer's declared texture dimensions to `22 × 17*2 = 22×34`.
 *
 * Effective UV dimensions: `CubeDefinition.bake()` multiplies the layer
 * texture by `texScale` per cube — `i * scaleU = 22 * 1 = 22` and
 * `j * scaleV = 34 * 0.5 = 17`. So the cube samples a 22×17 UV region, not
 * the full 22×34. We bake that effective size in directly here.
 *
 * Wrap structure (`bipedBody` → `armorBody` → `cape`) is intentional: it
 * triggers our `hasArmorBones` detection so the cosmetic mounts on the Steve
 * skeleton rather than going through the held-item bbox-center path.
 */
export const CAPE_GEO: ParsedGeo = {
  identifier: "geometry.nrc.cape",
  textureWidth: 22,
  textureHeight: 17,
  bones: [
    // Player skeleton stubs — needed so our `applyCosmeticTransform` and Steve
    // mount paths see standard armor* bones.
    { name: "bipedBody", pivot: [0, 24, 0] },
    { name: "armorBody", parent: "bipedBody", pivot: [0, 24, 0] },
    // Cape mount: offset (0, 0, 2) from body pivot puts the pivot at the back
    // surface of the body cube. Y=180° rotation flips the cape so its outer
    // face (authored as -Z in part-local) points away from the player.
    //
    // X=6° is MC's resting "natural drape": `PlayerCapeModel.setupAnim`
    // does `rotateX((6 + capeLean/2 + capeFlap) * π/180)` on top of the
    // base pose. With capeLean = capeFlap = 0 (idle), the constant 6°
    // remains and tilts the cape's bottom slightly back from the body so
    // it doesn't look glued to the player's back.
    {
      name: "cape",
      parent: "armorBody",
      pivot: [0, 24, 2],
      rotation: [-9, 180, 0],
      cubes: [
        // Cube extends from pivot DOWN by 16 px (body length) and is 1 px
        // thick. Coords are model-space; the bone's Y=180° rotation handles
        // the "behind player" placement.
        { origin: [-5, 8, 1], size: [10, 16, 1], uv: [0, 0] },
      ],
    },
  ],
};
