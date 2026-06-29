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

export function toRendererCosmetic(dto: ResolvedCosmeticDto): ResolvedCosmetic {
  const { particleData, ...rest } = dto.urls;
  const urls: CosmeticAssetUrls = {
    ...rest,
    particles: particleData ? particlesFrom(particleData) : undefined,
  };
  return { cosmeticId: dto.cosmeticId, name: dto.name, type: dto.type, urls };
}
