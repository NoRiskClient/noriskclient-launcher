import { invoke } from "@tauri-apps/api/core";

import type { CosmeticAssetUrls } from "../cosmetic-renderer/core";
import type { CosmeticSettings } from "../../types/cosmeticOutfit";

export const CMS_URL = "https://cms.norisk.gg";

interface CmsMedia {
  url?: string | null;
  width?: number | null;
  height?: number | null;
}

interface CmsDefaultSettings {
  scale?: number | null;
  previewScale?: number | null;
  offset?: { x?: number; y?: number; z?: number } | null;
  previewOffset?: { x?: number; y?: number; z?: number } | null;
}

export interface CmsProduct {
  cosmeticId: string;
  name?: string | null;
  slug?: string | null;
  category?: string | null;
  rarity?: string | null;
  creator?: string | null;
  type?: { name?: string | null } | string | null;
  defaultSettings?: CmsDefaultSettings | null;
  supportedBones?: string[] | null;
  assets?: {
    geoFile?: CmsMedia | string | null;
    animationFile?: CmsMedia | string | null;
    textureFile?: CmsMedia | string | null;
  } | null;
}

export interface ResolvedCosmetic {
  cosmeticId: string;
  name: string;
  type: string;
  urls: CosmeticAssetUrls;
}

function mediaUrl(field: CmsMedia | string | null | undefined): string | null {
  if (!field || typeof field === "string") return null;
  if (!field.url) return null;
  if (/^https?:\/\//.test(field.url)) {
    try {
      return `${CMS_URL}${new URL(field.url).pathname}`;
    } catch {
      return field.url;
    }
  }
  return `${CMS_URL}${field.url}`;
}

function mimeForUrl(url: string): string {
  return url.endsWith(".png") ? "image/png" : "application/json";
}

async function mediaBlobUrl(
  field: CmsMedia | string | null | undefined
): Promise<string | null> {
  const url = mediaUrl(field);
  if (!url) return null;
  const bytes = await invoke<number[]>("fetch_cms_media", { url });
  const blob = new Blob([new Uint8Array(bytes)], { type: mimeForUrl(url) });
  return URL.createObjectURL(blob);
}

function typeName(type: CmsProduct["type"]): string {
  if (!type) return "HAT";
  if (typeof type === "string") return type;
  return type.name ?? "HAT";
}

function buildTextureMcmeta(
  field: CmsMedia | string | null | undefined
): Record<string, unknown> | undefined {
  if (!field || typeof field === "string") return undefined;
  const width = typeof field.width === "number" ? field.width : 0;
  const height = typeof field.height === "number" ? field.height : 0;
  if (width <= 0 || height <= width || height % width !== 0) return undefined;
  return { animation: { frametime: 50, width, height: width } };
}

function buildMetadata(
  product: CmsProduct,
  settings?: CosmeticSettings
): Record<string, unknown> {
  const productDefaults = product.defaultSettings ?? {};
  const defaultSettings = {
    scale: settings?.scale ?? productDefaults.scale ?? 1,
    previewScale: settings?.previewScale ?? productDefaults.previewScale ?? 1,
    offset: settings?.offset ?? productDefaults.offset ?? { x: 0, y: 0, z: 0 },
    previewOffset:
      settings?.previewOffset ?? productDefaults.previewOffset ?? { x: 0, y: 0, z: 0 },
  };
  return {
    id: product.cosmeticId,
    name: product.name ?? "",
    type: typeName(product.type),
    path: product.slug ?? product.cosmeticId,
    creator: product.creator ?? null,
    rarity: product.rarity ?? null,
    supportedBones: Array.isArray(product.supportedBones) ? product.supportedBones : [],
    defaultSettings,
  };
}

export async function toResolvedCosmetic(
  product: CmsProduct,
  settings?: CosmeticSettings
): Promise<ResolvedCosmetic | null> {
  const assets = product.assets ?? {};
  const type = typeName(product.type);

  if (!mediaUrl(assets.textureFile)) return null;
  if (!mediaUrl(assets.geoFile) && type.toUpperCase() !== "CAPE") return null;

  const [texture, geo, animation] = await Promise.all([
    mediaBlobUrl(assets.textureFile),
    mediaBlobUrl(assets.geoFile),
    mediaBlobUrl(assets.animationFile),
  ]);

  if (!texture) return null;

  return {
    cosmeticId: product.cosmeticId,
    name: product.name ?? "",
    type,
    urls: {
      geo: geo ?? "",
      texture,
      animation: animation ?? undefined,
      mcmetaJson: buildTextureMcmeta(assets.textureFile),
      metadataJson: buildMetadata(product, settings),
    },
  };
}

export async function fetchCmsProducts(
  cosmeticIds: string[]
): Promise<Map<string, CmsProduct>> {
  const result = new Map<string, CmsProduct>();
  if (cosmeticIds.length === 0) return result;

  const json = await invoke<{ docs?: CmsProduct[] }>("get_cosmetic_products", {
    cosmeticIds,
  });
  for (const doc of json.docs ?? []) {
    if (doc.cosmeticId) result.set(doc.cosmeticId, doc);
  }
  return result;
}
