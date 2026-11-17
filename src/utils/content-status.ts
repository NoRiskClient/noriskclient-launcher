import type { Profile } from '../types/profile';
import type { UnifiedVersion } from '../types/unified';
import type { ContentInstallStatus } from '../types/profile';

export const statusForNewInstall = (
  previous?: ContentInstallStatus | null,
): ContentInstallStatus => ({
  is_installed: true,
  is_included_in_norisk_pack: previous?.is_included_in_norisk_pack || false,
  is_specific_version_in_pack: previous?.is_specific_version_in_pack || false,
  is_enabled: true,
  found_item_details: previous?.found_item_details || null,
  norisk_pack_item_details: previous?.norisk_pack_item_details || null,
});

export const findBestVersionForProfile = (
  profile: Profile,
  versions: UnifiedVersion[],
): UnifiedVersion | null => {
  if (!profile || !versions?.length) return null;

  if (profile.game_version && profile.loader) {
    const exact = versions.find(
      (v) => v.game_versions.includes(profile.game_version) && v.loaders.includes(profile.loader),
    );
    if (exact) return exact;
  }

  if (profile.game_version) {
    const byGameVersion = versions.find((v) => v.game_versions.includes(profile.game_version));
    if (byGameVersion) return byGameVersion;
  }

  return versions[0];
};
