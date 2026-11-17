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

function fromDto(dto: EquippedCosmeticsDto): EquippedCosmetics {
  const cosmetics = dto.cosmetics.map(toRendererCosmetic);

  const customCapeHash = dto.customCapeHash ?? null;
  if (customCapeHash) cosmetics.push(capeCosmetic(customCapeHash));

  return { cosmetics, customCapeHash };
}

export async function getEquippedCosmetics(
  playerIdentifier: string
): Promise<EquippedCosmetics> {
  const dto = await invoke<EquippedCosmeticsDto>("get_equipped_cosmetics", {
    playerIdentifier,
  });
  return fromDto(dto);
}

export async function getEquippedCosmeticsCached(
  playerIdentifier: string
): Promise<EquippedCosmetics | null> {
  const dto = await invoke<EquippedCosmeticsDto | null>("get_equipped_cosmetics_cached", {
    playerIdentifier,
  });
  return dto ? fromDto(dto) : null;
}
