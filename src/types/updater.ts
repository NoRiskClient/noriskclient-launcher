/**
 * Information about an available update.
 */
export interface UpdateInfo {
  /** The version number of the available update */
  version: string;
  /** The release date (optional) */
  date?: string;
  /** Release notes or changelog (optional) */
  body?: string;
  /** Download URL for the update (optional) */
  download_url?: string;
}

export interface LauncherUpdate extends UpdateInfo {
  ready: boolean;
}
