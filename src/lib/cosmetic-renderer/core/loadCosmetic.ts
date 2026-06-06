import * as THREE from "three";

import { buildBoneTree, type BoneTree } from "./buildBoneTree";
import { CAPE_GEO } from "./capeGeo";
import { parseAnimationFile } from "./parseAnimation";
import { parseGeo } from "./parseGeo";
import { parseMcmeta } from "./parseMcmeta";
import {
  disposeLoadedParticle,
  loadParticle,
  type LoadedParticleEffect,
  type ParticleAssetEntry,
} from "./particles";
import {
  buildRuntimeAnimations,
  type RuntimeAnimation,
} from "./runtimeAnimation";

import type { NoriskCosmeticMeta, ParsedGeo } from "./types";

/**
 * Resolved per-frame state for an animated texture.
 *
 * When non-null, the renderer should advance through `frames` at `frametime`
 * ticks each (1 tick = 50 ms) and update `texture.offset.y` to
 * `frameIndex * frameUvHeight`. `texture.repeat.y` is already pinned to
 * `frameUvHeight` by `loadCosmetic` so a single frame fills the model's UVs.
 */
export interface TextureAnimationState {
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  frametime: number;
  interpolate: boolean;
  frames: number[];
  frameUvHeight: number;
}

export interface LoadedCosmetic {
  geo: ParsedGeo;
  meta: NoriskCosmeticMeta;
  tree: BoneTree;
  /**
   * Live, per-frame animations. Drive them with `applyRuntimeAnimation` from
   * the render loop using your real elapsed time — the runner re-evaluates
   * Molang every frame so procedural animations don't have a wrap discontinuity.
   */
  animations: RuntimeAnimation[];
  /** Renderer config baked in at load time, exposed so callers can re-derive things. */
  config: { negateX: boolean };
  /**
   * True when the geo has any `armor*` bones — i.e. the cosmetic uses MC's
   * standard body-attachment convention (`armorBody`, `armorHead`, etc.).
   * False for SHIELDs and other held-item cosmetics that render via MC's
   * separate non-armor pipeline. Renderers should skip the Steve mount + use
   * a bbox-center fallback for these.
   */
  hasArmorBones: boolean;
  texture: THREE.Texture;
  material: THREE.Material;
  textureAnimation: TextureAnimationState | null;
  /**
   * Particle effects to emit while this cosmetic is mounted (continuous
   * auto-emit — primarily AURAs). Each entry pairs the loaded effect with
   * its asset entry so the caller knows the configured anchor bone.
   */
  particleEffects: LoadedCosmeticParticle[];
}

/**
 * One particle effect attached to a cosmetic. The renderer uses `anchor`
 * (defaults to the cosmetic's `tree.root` when absent) to resolve a
 * world-space spawn position each tick.
 */
export interface LoadedCosmeticParticle {
  entry: ParticleAssetEntry;
  loaded: LoadedParticleEffect;
}

/**
 * URLs (or any fetchable references) for one cosmetic's asset files.
 *
 * The renderer is transport-agnostic: it just `fetch()`s these URLs. Plug in
 * any backend — local dev server, CDN, S3 presigned URL, blob:// — as long as
 * the responses match the standard nrc-cosmetic file shapes.
 */
export interface CosmeticAssetUrls {
  /** `.geo.json` — Bedrock geometry, format 1.12.0. Required. */
  geo: string;
  /** `.png` — diffuse texture. Required. */
  texture: string;
  /** `.animation.json` — GeckoLib animations, format 1.8.0. Optional. */
  animation?: string;
  /** `.norisk.json` — preview metadata (offsets, scale). Optional. */
  metadata?: string;
  /** Pre-resolved `.norisk.json` shape. Useful when metadata comes from a CMS field. */
  metadataJson?: unknown;
  /** `.png.mcmeta` — animated-texture frame metadata. Optional. */
  mcmeta?: string;
  mcmetaJson?: unknown;
  /**
   * Optional `.particle.json` files attached to this cosmetic. The cosmetic
   * renderer continuously emits each effect at its configured anchor while
   * the cosmetic is mounted. Used primarily by AURAs.
   */
  particles?: ParticleAssetEntry[];
}

/**
 * Render-pipeline knobs that affect how the parsed geo + animations are
 * baked into THREE objects.
 */
export interface RenderConfig {
  /**
   * NRC cosmetics are conventionally authored in V2 LER-scaled space and
   * loaded with `negateX = true` (mirrors geometry/pivots/rotations on X to
   * land in identity render space). Keep on for nrc-assets; toggle off for
   * cosmetics already authored in identity space (rare).
   */
  negateX?: boolean;
  /**
   * Skip cubes outside the `armor*` subtree — the convention used by
   * `GeoCosmeticRenderer.findAndRenderArmorBones`. Disable to render every
   * bone (useful for previewing custom rigs that don't follow the convention).
   */
  armorOnly?: boolean;
}

/**
 * Convenience helper: build a CosmeticAssetUrls bundle by combining a slug
 * with a file-resolver callback.
 *
 *   const urls = cosmeticUrlsFor("bowtie", (file) => `/api/asset?file=${file}`);
 *   const cosmetic = await loadCosmetic(urls);
 */
export function cosmeticUrlsFor(
  slug: string,
  fileUrl: (file: string) => string
): CosmeticAssetUrls {
  return {
    geo: fileUrl(`${slug}.geo.json`),
    animation: fileUrl(`${slug}.animation.json`),
    texture: fileUrl(`${slug}.png`),
    mcmeta: fileUrl(`${slug}.png.mcmeta`),
    metadata: fileUrl(`${slug}.norisk.json`),
  };
}

/**
 * Fetch a cosmetic's asset files in parallel, parse them, and return a
 * fully-assembled THREE-ready bundle.
 *
 * The caller owns the returned resources and must call `disposeLoadedCosmetic`
 * once they're no longer rendered.
 */
export async function loadCosmetic(
  urls: CosmeticAssetUrls,
  config: RenderConfig = {}
): Promise<LoadedCosmetic> {
  const negateX = config.negateX ?? true;

  const particleEntries = urls.particles ?? [];
  const metadataPromise =
    urls.metadataJson !== undefined
      ? Promise.resolve(urls.metadataJson)
      : urls.metadata
        ? fetchJson(urls.metadata).catch(() => null)
        : Promise.resolve(null);
  const [geoJson, animJson, metaJson, mcmetaJson, texture, particleResults] =
    await Promise.all([
      urls.geo ? fetchJson(urls.geo).catch(() => null) : Promise.resolve(null),
      urls.animation ? fetchJson(urls.animation).catch(() => null) : Promise.resolve(null),
      metadataPromise,
      urls.mcmetaJson !== undefined
        ? Promise.resolve(urls.mcmetaJson)
        : urls.mcmeta
          ? fetchJson(urls.mcmeta).catch(() => null)
          : Promise.resolve(null),
      loadTexture(urls.texture),
      Promise.all(
        particleEntries.map((entry) =>
          loadParticle(entry.jsonUrl, entry.resolveTexture).catch((err) => {
            console.warn(`loadCosmetic: failed to load particle ${entry.jsonUrl}`, err);
            return null;
          })
        )
      ),
    ]);

  const meta = parseMeta(metaJson);

  // CAPE cosmetics ship without a `.geo.json` — MC reuses its vanilla
  // PlayerCapeModel for all of them. Fall back to a hardcoded equivalent.
  let geo: ParsedGeo;
  if (geoJson) {
    geo = parseGeo(geoJson);
  } else if (meta.type === "CAPE") {
    geo = CAPE_GEO;
  } else {
    throw new Error(
      `loadCosmetic: missing .geo.json and no fallback for type ${meta.type || "(unknown)"}`
    );
  }

  const animFile = animJson
    ? parseAnimationFile(animJson)
    : { formatVersion: "1.8.0", animations: [] };
  const textureAnimation = buildTextureAnimation(mcmetaJson, texture);

  // Auto-fallback for cosmetics whose geo has no `armor*` bones (e.g. SHIELDs,
  // which MC renders via a separate non-armor pipeline `CosmeticShieldSpecial-
  // Renderer`). When there are no armor bones the filter would skip every
  // cube, so we hard-disable it regardless of what the caller passed —
  // an empty render is never the desired outcome.
  const hasArmorBones = geo.bones.some((b) =>
    b.name.toLowerCase().startsWith("armor")
  );
  const armorOnly = hasArmorBones && (config.armorOnly ?? true);

  if (textureAnimation) {
    texture.repeat.y = textureAnimation.frameUvHeight;
    texture.offset.y = 0;
  }

  // Cape texture-layout normalization. CAPE_GEO declares a 22×17 UV space
  // (the actual cape region), but vanilla-format cape textures (e.g.
  // legacy player skin elytra layout, 64×32 base) embed that 22×17 inside
  // a larger 64×32 sheet. Detect which by frame aspect ratio:
  //   - 22:17 (≈1.294) → NRC cape-only frame, no extra repeat needed.
  //   - 64:32 (= 2.0)  → vanilla, scale repeat to sample the cape region.
  if (geo === CAPE_GEO) {
    const img = texture.image as { width?: number; height?: number } | undefined;
    const frameW = textureAnimation?.frameWidth ?? img?.width ?? 0;
    const frameH = textureAnimation?.frameHeight ?? img?.height ?? 0;
    if (frameW > 0 && frameH > 0) {
      const aspect = frameW / frameH;
      const isVanilla64x32 = Math.abs(aspect - 2.0) < Math.abs(aspect - 22 / 17);
      if (isVanilla64x32) {
        texture.repeat.x = 22 / 64;
        texture.repeat.y *= 17 / 32;
      }
    }
  }

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.01,
    roughness: 1.0,
    metalness: 0.0,
  });

  const tree = buildBoneTree(geo, material, { negateX, armorOnly });
  const animations = buildRuntimeAnimations(animFile, geo, tree, { negateX });

  const particleEffects: LoadedCosmeticParticle[] = [];
  for (let i = 0; i < particleResults.length; i++) {
    const lp = particleResults[i];
    if (!lp) continue;
    particleEffects.push({ entry: particleEntries[i], loaded: lp });
  }

  return {
    geo,
    meta,
    tree,
    animations,
    config: { negateX },
    hasArmorBones,
    texture,
    material,
    textureAnimation,
    particleEffects,
  };
}

export function disposeLoadedCosmetic(c: LoadedCosmetic) {
  for (const pe of c.particleEffects) {
    disposeLoadedParticle(pe.loaded);
  }
  c.particleEffects.length = 0;
  c.texture.dispose();
  if ("dispose" in c.material && typeof c.material.dispose === "function") {
    c.material.dispose();
  }
  c.tree.root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
    }
  });
}

function buildTextureAnimation(
  mcmetaJson: unknown,
  texture: THREE.Texture
): TextureAnimationState | null {
  if (!mcmetaJson) return null;
  const info = parseMcmeta(mcmetaJson);
  if (!info) return null;

  const img = texture.image as { width?: number; height?: number } | undefined;
  if (!img?.width || !img.height) return null;

  const frameWidth = info.frameWidth ?? img.width;
  const frameHeight = info.frameHeight ?? frameWidth;
  if (frameHeight <= 0) return null;

  const frameCount = Math.max(1, Math.floor(img.height / frameHeight));
  if (frameCount <= 1) return null;

  const declared = info.frames && info.frames.length > 0 ? info.frames : null;
  const frames =
    declared?.filter((i) => i >= 0 && i < frameCount) ??
    Array.from({ length: frameCount }, (_, i) => i);
  if (frames.length === 0) return null;

  return {
    frameCount,
    frameWidth,
    frameHeight,
    frametime: info.frametime,
    interpolate: info.interpolate,
    frames,
    frameUvHeight: frameHeight / img.height,
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url}: HTTP ${r.status}`);
  return r.json();
}

function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err)))
    );
  });
}

function parseMeta(json: unknown): NoriskCosmeticMeta {
  const o = (json ?? {}) as Record<string, unknown>;
  const ds = (o.defaultSettings ?? {}) as Record<string, unknown>;
  const offset = (ds.offset ?? {}) as { x?: unknown; y?: unknown; z?: unknown };
  const previewOffset = (ds.previewOffset ?? {}) as {
    x?: unknown;
    y?: unknown;
    z?: unknown;
  };
  return {
    id: typeof o.id === "string" ? o.id : "",
    name: typeof o.name === "string" ? o.name : "",
    type: typeof o.type === "string" ? o.type : "",
    path: typeof o.path === "string" ? o.path : "",
    creator: typeof o.creator === "string" ? o.creator : null,
    rarity: typeof o.rarity === "string" ? o.rarity : null,
    supportedBones: Array.isArray(o.supportedBones)
      ? (o.supportedBones.filter((s) => typeof s === "string") as string[])
      : [],
    defaultSettings: {
      scale: typeof ds.scale === "number" ? ds.scale : 1.0,
      previewScale: typeof ds.previewScale === "number" ? ds.previewScale : 1.0,
      offset: [
        typeof offset.x === "number" ? offset.x : 0,
        typeof offset.y === "number" ? offset.y : 0,
        typeof offset.z === "number" ? offset.z : 0,
      ],
      previewOffset: [
        typeof previewOffset.x === "number" ? previewOffset.x : 0,
        typeof previewOffset.y === "number" ? previewOffset.y : 0,
        typeof previewOffset.z === "number" ? previewOffset.z : 0,
      ],
    },
  };
}
