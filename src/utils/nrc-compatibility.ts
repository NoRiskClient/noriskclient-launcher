import type { NoriskModpacksConfig } from "../types/noriskPacks";

export interface NrcCompatibilityData {
  compatibleVersions: Set<string>;
  compatibleLoadersByVersion: Map<string, Set<string>>;
}

export function extractNrcCompatibility(
  packsConfig: NoriskModpacksConfig
): NrcCompatibilityData {
  const compatibleVersions = new Set<string>();
  const compatibleLoadersByVersion = new Map<string, Set<string>>();

  for (const pack of Object.values(packsConfig.packs)) {
    if (!pack?.mods) continue;

    for (const mod of pack.mods) {
      if (mod.id === "noriskclient-client" || mod.id === "nrc-client") {
        if (mod.compatibility) {
          for (const [version, loaderMap] of Object.entries(mod.compatibility)) {
            compatibleVersions.add(version);

            if (!compatibleLoadersByVersion.has(version)) {
              compatibleLoadersByVersion.set(version, new Set());
            }

            for (const loader of Object.keys(loaderMap)) {
              compatibleLoadersByVersion.get(version)!.add(loader);
            }
          }
        }
      }
    }
  }

  return { compatibleVersions, compatibleLoadersByVersion };
}
