import { invoke } from "@tauri-apps/api/core";

import {
  toRendererCosmetic,
  type ResolvedCosmetic,
  type ResolvedCosmeticDto,
} from "../lib/cosmetics/cosmeticRendererAssets";
import { getCapeImageUrl } from "./cape-service";

export interface EquippedCosmetics {
  cosmetics: ResolvedCosmetic[];
  customCapeHash: string | null;
}

interface EquippedCosmeticsDto {
  cosmetics: ResolvedCosmeticDto[];
  customCapeHash: string | null;
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

export async function getEquippedCosmetics(
  playerIdentifier: string
): Promise<EquippedCosmetics> {
  const dto = await invoke<EquippedCosmeticsDto>("get_equipped_cosmetics", {
    playerIdentifier,
  });

  const cosmetics = dto.cosmetics.map(toRendererCosmetic);

  const customCapeHash = dto.customCapeHash ?? null;
  if (customCapeHash) cosmetics.push(capeCosmetic(customCapeHash));

  return { cosmetics, customCapeHash };
}
