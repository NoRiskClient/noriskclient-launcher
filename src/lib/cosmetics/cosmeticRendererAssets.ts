import { convertFileSrc } from "@tauri-apps/api/core";

import type {
  CosmeticAssetUrls,
  ParticleAssetEntry,
} from "@noriskclient/nrc-skin-renderer/core";

export interface ResolvedCosmetic {
  cosmeticId: string;
  name: string;
  type: string;
  urls: CosmeticAssetUrls;
}

interface ParticleAssetDataDto {
  jsonUrl: string;
  dir: string;
  particleFiles: string[];
}

interface CosmeticAssetUrlsDto {
  geo: string;
  texture: string;
  animation?: string;
  metadataJson: unknown;
  mcmeta?: string;
  particleData?: ParticleAssetDataDto[];
}

export interface ResolvedCosmeticDto {
  cosmeticId: string;
  name: string;
  type: string;
  urls: CosmeticAssetUrlsDto;
}

function particlesFrom(data: ParticleAssetDataDto[]): ParticleAssetEntry[] {
  return data.map((d) => {
    const have = new Set(d.particleFiles);
    return {
      jsonUrl: d.jsonUrl,
      resolveTexture: (ref: string) => {
        const stripped = ref.includes(":")
          ? ref.split(":").slice(1).join(":")
          : ref;
        let file = stripped.split("/").pop() || stripped;
        if (!file.endsWith(".png")) file += ".png";
        return have.has(file) ? `${d.dir}particle/${file}` : `${d.dir}${file}`;
      },
    };
  });
}

function assetUrl(u: string | undefined): string | undefined {
  if (!u) return u;
  return /^https?:\/\//.test(u) ? u : convertFileSrc(u);
}

export function toRendererCosmetic(dto: ResolvedCosmeticDto): ResolvedCosmetic {
  const { particleData, metadataJson, geo, texture, animation, mcmeta } =
    dto.urls;
  const urls: CosmeticAssetUrls = {
    geo: assetUrl(geo) ?? "",
    texture: assetUrl(texture) ?? "",
    animation: assetUrl(animation),
    mcmeta: assetUrl(mcmeta),
    metadataJson,
    particles: particleData ? particlesFrom(particleData) : undefined,
  };
  return { cosmeticId: dto.cosmeticId, name: dto.name, type: dto.type, urls };
}
