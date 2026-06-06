import * as THREE from "three";

import { buildBoneTree, type BoneTree } from "./buildBoneTree";
import { parseEmoteFile } from "./parseEmote";
import { parseGeo } from "./parseGeo";
import { parseMcmeta } from "./parseMcmeta";
import {
  disposeLoadedParticle,
  loadParticle,
  type LoadedParticleEffect,
  type ParticleAssetEntry,
} from "./particles";
import type { TextureAnimationState } from "./loadCosmetic";

import type { ParsedEmote, ParsedGeo } from "./types";

/**
 * URLs (or any fetchable references) for one emote's asset files.
 *
 * Only `animation` is required. The other three are optional — most emotes
 * are pure-animation (pose changes only) and ship without a prop model. When
 * any of them are present they describe a prop that renders alongside the
 * Steve rig (e.g. the gaming chair under `gamingchair`).
 */
export interface EmoteAssetUrls {
  /** `.animation.json` — required. Contains bone tracks + emote metadata. */
  animation: string;
  /** `.geo.json` — optional. Bedrock geometry for a prop attached to the rig. */
  geo?: string;
  /** `.png` — optional. Diffuse texture for the prop. */
  texture?: string;
  /** `.png.mcmeta` — optional. Animated-strip metadata for the prop texture. */
  mcmeta?: string;
  /**
   * Optional list of `.particle.json` files this emote can spawn from its
   * keyframe events. Loaded in parallel with the rest of the assets;
   * indexed by `description.identifier` for keyframe-time lookup.
   */
  particles?: ParticleAssetEntry[];
}

/**
 * A loaded emote ready to drive an `EmotePlayer`.
 *
 * Files declare a single emote-id when they have just one animation, but the
 * format technically allows multiple animations per file. We expose the full
 * list and pick a "primary" id for convenience (the first parsed animation,
 * which matches the on-disk slug for every file in nrc-assets).
 */
export interface LoadedEmote {
  /** Primary emote — the one a single-emote file describes. */
  emote: ParsedEmote;
  /** All emotes parsed from the same file (1+ entries). */
  emotes: ParsedEmote[];
  /** Optional prop assets when the emote ships a `.geo.json` + `.png`. */
  prop: LoadedProp | null;
  /**
   * Loaded particle effects, indexed by their `description.identifier`
   * (e.g. `noriskclient-cosmetics:firework/firework1`). The KeyframeListener
   * looks up the effect by id and calls `system.spawn(id, ...)`.
   */
  particleEffects: Map<string, LoadedParticleEffect>;
}

/**
 * Renderable prop bundled with an emote. The bone tree's `armorBody`-style
 * conventions match the Steve rig, so callers can mount the prop's root onto
 * the Steve's `armorBody` group and it inherits the body's animation.
 */
export interface LoadedProp {
  geo: ParsedGeo;
  tree: BoneTree;
  texture: THREE.Texture;
  material: THREE.Material;
  textureAnimation: TextureAnimationState | null;
}

export interface EmoteRenderConfig {
  /**
   * Mirror authored-in-V2-LER-space coordinates on X. Match whatever the
   * Steve rig uses (`true` by default). Don't mix.
   */
  negateX?: boolean;
}

/**
 * Convenience: build an `EmoteAssetUrls` bundle from a slug + url-resolver.
 *
 *   const urls = emoteUrlsFor("gamingchair", (f) => `/asset?file=${f}`);
 */
export function emoteUrlsFor(
  slug: string,
  fileUrl: (file: string) => string
): EmoteAssetUrls {
  return {
    animation: fileUrl(`${slug}.animation.json`),
    geo: fileUrl(`${slug}.geo.json`),
    texture: fileUrl(`${slug}.png`),
    mcmeta: fileUrl(`${slug}.png.mcmeta`),
  };
}

/**
 * Fetch + parse an emote's asset files in parallel. Errors on the prop
 * (geo / texture / mcmeta) are swallowed so emotes without props degrade
 * gracefully — only the animation is mandatory.
 */
export async function loadEmote(
  urls: EmoteAssetUrls,
  config: EmoteRenderConfig = {}
): Promise<LoadedEmote> {
  const negateX = config.negateX ?? true;

  const particleEntries = urls.particles ?? [];
  const [animJson, geoJson, mcmetaJson, propTexture, particleResults] =
    await Promise.all([
      fetchJson(urls.animation),
      urls.geo ? fetchJson(urls.geo).catch(() => null) : Promise.resolve(null),
      urls.mcmeta
        ? fetchJson(urls.mcmeta).catch(() => null)
        : Promise.resolve(null),
      urls.texture
        ? loadTexture(urls.texture).catch(() => null)
        : Promise.resolve(null),
      // Particle loads are independent — failures don't block the emote.
      Promise.all(
        particleEntries.map((entry) =>
          loadParticle(entry.jsonUrl, entry.resolveTexture).catch((err) => {
            console.warn(`loadEmote: failed to load particle ${entry.jsonUrl}`, err);
            return null;
          })
        )
      ),
    ]);

  const file = parseEmoteFile(animJson);
  if (file.emotes.length === 0) {
    // Free everything we already loaded — we never wrap them in a LoadedEmote
    // when there's no emote to drive it.
    propTexture?.dispose();
    for (const lp of particleResults) {
      if (lp) disposeLoadedParticle(lp);
    }
    throw new Error("loadEmote: animation file contains no emotes");
  }

  let prop: LoadedProp | null = null;
  if (geoJson && propTexture) {
    const geo = parseGeo(geoJson);
    // armorOnly: true (default) skips the Steve-shaped preview cubes that
    // emote authors bake into prop geos for alignment reference. The actual
    // prop bone (e.g. `gamerchair`) is parented under `armorBody`, which
    // means it's still in the `armor*` subtree and renders correctly.
    const material = new THREE.MeshStandardMaterial({
      map: propTexture,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.01,
      roughness: 1.0,
      metalness: 0.0,
    });
    const tree = buildBoneTree(geo, material, { negateX });
    const textureAnimation = buildTextureAnimation(mcmetaJson, propTexture);
    if (textureAnimation) {
      propTexture.repeat.y = textureAnimation.frameUvHeight;
      propTexture.offset.y = 0;
    }
    prop = {
      geo,
      tree,
      texture: propTexture,
      material,
      textureAnimation,
    };
  } else if (propTexture && !geoJson) {
    // No geo to render against — drop the dangling texture so callers don't
    // accidentally hang on to a GPU resource that no LoadedProp owns.
    propTexture.dispose();
  }

  const particleEffects = new Map<string, LoadedParticleEffect>();
  for (const loaded of particleResults) {
    if (!loaded) continue;
    if (!loaded.effect.identifier) continue;
    particleEffects.set(loaded.effect.identifier, loaded);
  }

  return {
    emote: file.emotes[0],
    emotes: file.emotes,
    prop,
    particleEffects,
  };
}

/**
 * Free GPU resources owned by a `LoadedEmote`. Safe to call multiple times.
 */
export function disposeLoadedEmote(loaded: LoadedEmote) {
  const prop = loaded.prop;
  if (prop) {
    prop.texture.dispose();
    if ("dispose" in prop.material && typeof prop.material.dispose === "function") {
      prop.material.dispose();
    }
    prop.tree.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      }
    });
  }
  for (const loadedParticle of loaded.particleEffects.values()) {
    disposeLoadedParticle(loadedParticle);
  }
  loaded.particleEffects.clear();
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
