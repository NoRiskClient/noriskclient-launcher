import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * Gets or downloads an asset model file from a CDN URL and converts it to a web-accessible URL.
 * 
 * The function downloads the file (always re-downloads to ensure latest version) and saves it to the local assets directory.
 * Then converts the local path to a web-accessible URL using convertFileSrc.
 * 
 * @param url - The CDN URL of the asset model (e.g., "https://cdn.norisk.gg/asset-models/cosmetics/hat/amethyst_halo/amethyst_halo.gltf")
 * @returns A promise that resolves to a web-accessible URL for the asset model
 * @throws If the download fails or the URL is invalid
 * 
 * @example
 * ```typescript
 * const assetUrl = await getOrDownloadAssetModel('https://cdn.norisk.gg/asset-models/cosmetics/hat/amethyst_halo/amethyst_halo.gltf');
 * // Returns: "http://localhost:1420/asset:///C:/Users/.../amethyst_halo.gltf"
 * ```
 */
export const getOrDownloadAssetModel = async (url: string): Promise<string> => {
  const localPath = await invoke<string>('get_or_download_asset_model', { url });
  return convertFileSrc(localPath);
};

