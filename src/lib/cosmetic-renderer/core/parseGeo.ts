import type { BedrockGeoFile, ParsedGeo } from "./types";

/**
 * Pull the first (and in practice only) geometry entry from a Bedrock .geo.json.
 * nrc-cosmetics always have exactly one geometry per file.
 */
export function parseGeo(json: unknown): ParsedGeo {
  const file = json as BedrockGeoFile;
  const entries = file["minecraft:geometry"];
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("geo.json: no minecraft:geometry entries");
  }

  const geo = entries[0];
  const desc = geo.description ?? { identifier: "geometry.unknown" };

  return {
    identifier: desc.identifier ?? "geometry.unknown",
    textureWidth: desc.texture_width ?? 64,
    textureHeight: desc.texture_height ?? 64,
    bones: Array.isArray(geo.bones) ? geo.bones : [],
  };
}
