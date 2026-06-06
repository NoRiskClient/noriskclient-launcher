import * as THREE from "three";

import { parseParticle } from "./parseParticle";

import type { ParsedParticleEffect } from "./types";

/**
 * A `.particle.json` after fetch + parse + texture decode. Caller owns the
 * THREE.Texture and must dispose it via `disposeLoadedParticle` when done.
 */
export interface LoadedParticleEffect {
  effect: ParsedParticleEffect;
  texture: THREE.Texture;
}

/**
 * One entry in an emote/cosmetic's particle bundle. The caller passes a
 * `jsonUrl` (URL to fetch the `.particle.json`) and a `resolveTexture`
 * callback that the loader invokes once per file with the raw Bedrock
 * `description.basic_render_parameters.texture` string.
 *
 * Optional `anchor`: bone name on the parent rig where this effect should
 * spawn. If absent, the caller decides where to anchor at mount time
 * (typically the rig's root).
 */
export interface ParticleAssetEntry {
  jsonUrl: string;
  resolveTexture: (textureRef: string) => string;
  anchor?: string;
}

/**
 * Fetch a particle JSON, parse it, and load the referenced texture.
 *
 * The Bedrock texture reference looks like
 * `noriskclient-cosmetics:flower/heart.particle` — we don't know how to map it
 * to a fetchable URL ourselves (file layout depends on the asset host), so the
 * caller passes a `resolveTexture` callback. The callback receives the raw
 * Bedrock string and returns a URL string that can be fetched as a PNG.
 */
export async function loadParticle(
  jsonUrl: string,
  resolveTexture: (textureRef: string) => string
): Promise<LoadedParticleEffect> {
  const json = await fetchJson(jsonUrl);
  const effect = parseParticle(json);
  if (!effect.identifier) {
    throw new Error(`loadParticle: ${jsonUrl} has no description.identifier`);
  }
  const textureUrl = resolveTexture(effect.textureRef);
  const texture = await loadTexture(textureUrl);
  return { effect, texture };
}

export function disposeLoadedParticle(loaded: LoadedParticleEffect): void {
  loaded.texture.dispose();
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
        // Particle atlases are pixel-art — keep nearest filtering so flipbook
        // frames don't bleed into each other along subpixel boundaries.
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.generateMipmaps = false;
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
