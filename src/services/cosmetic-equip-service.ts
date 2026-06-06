import { invoke } from "@tauri-apps/api/core";

import {
  type CosmeticRealOutfit,
  ZERO_UUID,
} from "../types/cosmeticOutfit";
import {
  fetchCmsProducts,
  toResolvedCosmetic,
  type ResolvedCosmetic,
} from "../lib/cosmetics/cosmeticRendererAssets";
import { resolvePackCosmetic } from "../lib/cosmetics/cosmeticPack";
import { getCapeImageUrl } from "./cape-service";

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
      resolvePackCosmetic(id, settingsById[id]).catch(() => null)
    )
  );

  const missingIds = cosmeticIds.filter((id, i) => packResolved[i] === null);
  const products =
    missingIds.length > 0 ? await fetchCmsProducts(missingIds) : new Map();
  const cmsResolved = await Promise.all(
    missingIds.map((id) => {
      const product = products.get(id);
      if (!product) return Promise.resolve(null);
      return toResolvedCosmetic(product, settingsById[id]).catch(() => null);
    })
  );

  const cosmetics = [...packResolved, ...cmsResolved].filter(
    (c): c is ResolvedCosmetic => c !== null
  );

  if (customCapeHash) cosmetics.push(capeCosmetic(customCapeHash));

  return { cosmetics, customCapeHash };
}
