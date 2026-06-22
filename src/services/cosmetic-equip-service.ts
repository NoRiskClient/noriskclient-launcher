import { invoke } from "@tauri-apps/api/core";

import {
  type CosmeticRealOutfit,
  type CosmeticSettings,
  type CustomTextureSource,
  ZERO_UUID,
} from "../types/cosmeticOutfit";
import {
  fetchCmsProducts,
  toResolvedCosmetic,
  type ResolvedCosmetic,
} from "../lib/cosmetics/cosmeticRendererAssets";
import { resolvePackCosmetic } from "../lib/cosmetics/cosmeticPack";
import { getCapeImageUrl, getPlayerProfileByUuidOrName } from "./cape-service";
import type { TexturesData } from "../types/minecraft";

async function skinUrlForPlayerName(name: string): Promise<string | null> {
  if (!name) return null;
  try {
    const profile = await getPlayerProfileByUuidOrName(name);
    const texturesProp = profile.properties?.find((p) => p.name === "textures");
    if (!texturesProp) return null;
    const decoded = JSON.parse(atob(texturesProp.value)) as TexturesData;
    const url = decoded.textures?.SKIN?.url;
    return url ? url.replace(/^http:/, "https:") : null;
  } catch {
    return null;
  }
}

async function resolveCustomSkinUrl(
  src?: CustomTextureSource | null
): Promise<string | null> {
  if (!src) return null;
  switch (src.type) {
    case "playerName":
      return skinUrlForPlayerName(src.name);
    case "url":
      return src.url || null;
    case "base64":
      if (!src.data) return null;
      return src.data.startsWith("data:")
        ? src.data
        : `data:image/png;base64,${src.data}`;
    default:
      return null;
  }
}

async function applyCustomTexture(
  cosmetic: ResolvedCosmetic | null,
  settings?: CosmeticSettings
): Promise<ResolvedCosmetic | null> {
  if (!cosmetic) return cosmetic;
  const url = await resolveCustomSkinUrl(settings?.customTexture);
  if (url) cosmetic.urls.texture = url;
  return cosmetic;
}

function capeCosmetic(hash: string): ResolvedCosmetic {
  return {
    cosmeticId: `cape:${hash}`,
    name: "Cape",
    type: "CAPE",
    urls: {
      geo: "",
      texture: getCapeImageUrl(hash, false),
      metadataJson: {
        id: `cape:${hash}`,
        name: "Cape",
        type: "CAPE",
        path: "cape",
        defaultSettings: {
          scale: 1,
          previewScale: 1,
          offset: { x: 0, y: 0, z: 0 },
          previewOffset: { x: 0, y: 0, z: 0 },
        },
      },
    },
  };
}

export interface EquippedCosmetics {
  cosmetics: ResolvedCosmetic[];
  customCapeHash: string | null;
}

export async function getEquippedCosmetics(
  playerIdentifier: string
): Promise<EquippedCosmetics> {
  const real = await invoke<CosmeticRealOutfit>("get_player_outfit", {
    payload: { player_identifier: playerIdentifier },
  });

  const outfit = real?.outfit;
  if (!outfit?.cosmeticSettings) {
    return { cosmetics: [], customCapeHash: null };
  }

  const settingsById = outfit.cosmeticSettings;
  const customCapeHash = outfit.customCapeHash ?? null;

  const owned = Array.isArray(real.ownedCosmetics) ? real.ownedCosmetics : [];
  const allEquipped = Object.keys(settingsById).filter(
    (id) => id !== ZERO_UUID
  );
  const ownedEquipped = allEquipped.filter((id) => owned.includes(id));
  const cosmeticIds =
    ownedEquipped.length > 0 ? ownedEquipped : allEquipped;

  if (cosmeticIds.length === 0) {
    return { cosmetics: [], customCapeHash };
  }

  const packResolved = await Promise.all(
    cosmeticIds.map((id) =>
      resolvePackCosmetic(id, settingsById[id])
        .then((c) => applyCustomTexture(c, settingsById[id]))
        .catch(() => null)
    )
  );

  const missingIds = cosmeticIds.filter((id, i) => packResolved[i] === null);
  const products =
    missingIds.length > 0 ? await fetchCmsProducts(missingIds) : new Map();
  const cmsResolved = await Promise.all(
    missingIds.map((id) => {
      const product = products.get(id);
      if (!product) return Promise.resolve(null);
      return toResolvedCosmetic(product, settingsById[id])
        .then((c) => applyCustomTexture(c, settingsById[id]))
        .catch(() => null);
    })
  );

  const cosmetics = [...packResolved, ...cmsResolved].filter(
    (c): c is ResolvedCosmetic => c !== null
  );

  if (customCapeHash) cosmetics.push(capeCosmetic(customCapeHash));

  return { cosmetics, customCapeHash };
}
