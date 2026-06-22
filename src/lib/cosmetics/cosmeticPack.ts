import type { CosmeticSettings } from "../../types/cosmeticOutfit";
import type { ResolvedCosmetic } from "./cosmeticRendererAssets";
import type {
  ParticleAssetEntry,
  EmoteAssetUrls,
} from "@noriskclient/nrc-skin-renderer/core";

const PACK = "norisk-prod";
const INDEX_URL = `https://api.norisk.gg/api/v1/launcher/pack/${PACK}`;
const CDN_BASE = `https://cdn.norisk.gg/assets/${PACK}/assets/`;

interface PackObject {
  hash: string;
  size: number;
  uuid: string | null;
}
interface PackIndex {
  objects: Record<string, PackObject>;
}

interface ParsedPack {
  byUuid: Map<string, string>;
  paths: Set<string>;
}

let cache: Promise<ParsedPack> | null = null;

function loadPackIndex(): Promise<ParsedPack> {
  if (!cache) {
    cache = fetch(INDEX_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`pack index ${r.status}`);
        return r.json() as Promise<PackIndex>;
      })
      .then((index) => {
        const byUuid = new Map<string, string>();
        const paths = new Set<string>();
        for (const [path, obj] of Object.entries(index.objects ?? {})) {
          paths.add(path);
          if (obj.uuid) byUuid.set(obj.uuid, path);
        }
        return { byUuid, paths };
      })
      .catch((err) => {
        cache = null;
        throw err;
      });
  }
  return cache;
}

function cdnUrl(objectPath: string): string {
  return `${CDN_BASE}${objectPath}`;
}

function resolveParticleTexture(
  dir: string,
  textureRef: string,
  paths: Set<string>
): string {
  const stripped = textureRef.includes(":")
    ? textureRef.split(":").slice(1).join(":")
    : textureRef;
  let file = stripped.split("/").pop() || stripped;
  if (!file.endsWith(".png")) file += ".png";
  if (paths.has(`${dir}particle/${file}`)) return cdnUrl(`${dir}particle/${file}`);
  return cdnUrl(`${dir}${file}`);
}

function particleEntriesFor(dir: string, paths: Set<string>): ParticleAssetEntry[] {
  const entries: ParticleAssetEntry[] = [];
  for (const p of paths) {
    if (p.length > dir.length && p.startsWith(dir) && p.endsWith(".particle.json")) {
      entries.push({
        jsonUrl: cdnUrl(p),
        resolveTexture: (ref) => resolveParticleTexture(dir, ref, paths),
      });
    }
  }
  return entries;
}

function mergeSettings(
  meta: Record<string, unknown>,
  settings?: CosmeticSettings
): Record<string, unknown> {
  const ds: Record<string, unknown> = {
    ...((meta.defaultSettings as Record<string, unknown>) ?? {}),
  };
  if (settings?.scale != null) ds.scale = settings.scale;
  if (settings?.offset) ds.offset = settings.offset;
  return { ...meta, defaultSettings: ds };
}

export async function resolveEmoteBySlug(
  slug: string
): Promise<EmoteAssetUrls | null> {
  const { paths } = await loadPackIndex();
  const suffix = `/emotes/${slug}.animation.json`;
  const nestedSuffix = `/emotes/${slug}/${slug}.animation.json`;
  let pick: string | undefined;
  for (const p of paths) {
    if (p.endsWith(suffix) || p.endsWith(nestedSuffix)) {
      pick = p;
      break;
    }
  }
  if (!pick) return null;

  const dir = pick.slice(0, pick.lastIndexOf("/") + 1);
  const base = pick.slice(dir.length, pick.length - ".animation.json".length);

  const geoPath = `${dir}${base}.geo.json`;
  const texPath = `${dir}${base}.png`;
  const mcmetaPath = `${dir}${base}.png.mcmeta`;

  return {
    animation: cdnUrl(pick),
    geo: paths.has(geoPath) ? cdnUrl(geoPath) : "",
    texture: paths.has(texPath) ? cdnUrl(texPath) : "",
    mcmeta: paths.has(mcmetaPath) ? cdnUrl(mcmetaPath) : undefined,
  };
}

export async function resolvePackCosmetic(
  cosmeticId: string,
  settings?: CosmeticSettings
): Promise<ResolvedCosmetic | null> {
  const { byUuid, paths } = await loadPackIndex();
  const metaPath = byUuid.get(cosmeticId);
  if (!metaPath) return null;

  const dir = metaPath.slice(0, metaPath.lastIndexOf("/") + 1);
  const base = metaPath.slice(dir.length, metaPath.length - ".norisk.json".length);

  const geoPath = `${dir}${base}.geo.json`;
  const animPath = `${dir}${base}.animation.json`;
  const texPath = `${dir}${base}.png`;
  const mcmetaPath = `${dir}${base}.png.mcmeta`;

  let metadataJson: Record<string, unknown>;
  try {
    const metaRes = await fetch(cdnUrl(metaPath));
    metadataJson = mergeSettings(await metaRes.json(), settings);
  } catch {
    return null;
  }

  const type = typeof metadataJson.type === "string" ? metadataJson.type : "HAT";
  const hasGeo = paths.has(geoPath);
  if (!hasGeo && type.toUpperCase() !== "CAPE") return null;
  if (!paths.has(texPath)) return null;

  const particles = particleEntriesFor(dir, paths);

  return {
    cosmeticId,
    name: typeof metadataJson.name === "string" ? metadataJson.name : "",
    type,
    urls: {
      geo: hasGeo ? cdnUrl(geoPath) : "",
      texture: cdnUrl(texPath),
      animation: paths.has(animPath) ? cdnUrl(animPath) : undefined,
      mcmeta: paths.has(mcmetaPath) ? cdnUrl(mcmetaPath) : undefined,
      metadataJson,
      particles: particles.length > 0 ? particles : undefined,
    },
  };
}
