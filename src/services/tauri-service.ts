import { openUrl, openPath } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import type { ScreenshotInfo } from '../types/profile';

/**
 * Opens a given URL in the default external application (usually the web browser).
 * Requires the `plugin-opener` to be configured and appropriate permissions granted.
 * See: https://v2.tauri.app/plugin/opener/
 *
 * @param url The URL to open (e.g., 'https://example.com').
 * @throws If the opener plugin fails to open the URL (e.g., due to permissions or invalid URL).
 */
export const openExternalUrl = (url: string): Promise<void> => {
  // Directly call the plugin function. Errors propagate to the caller.
  return openUrl(url);
};

/**
 * Invokes the backend command to get a processed image preview.
 *
 * @param payload The necessary information to generate the preview (path, optional dimensions/quality).
 * @returns A promise that resolves with the image preview data.
 * @throws If the backend command fails.
 */
export const getImageThumbnail = (path: string, size: number): Promise<string> =>
  invoke<string>('get_image_thumbnail', { path, size });

export const listProfileScreenshots = (profileId: string): Promise<ScreenshotInfo[]> =>
  invoke<ScreenshotInfo[]>('list_profile_screenshots', { profileId });

/**
 * Gets the launcher directory path from the backend.
 *
 * @returns A promise that resolves with the launcher directory path.
 * @throws If the backend command fails.
 */
export const getLauncherDirectory = (): Promise<string> => {
  return invoke<string>('get_launcher_directory');
};

/**
 * Opens the launcher directory in the system's file explorer.
 * Uses openPath to directly open the directory.
 *
 * @throws If the opener plugin fails to open the directory.
 */
export const openLauncherDirectory = async (): Promise<void> => {
  const launcherPath = await getLauncherDirectory();
  await openPath(launcherPath);
}; 