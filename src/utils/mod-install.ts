import UnifiedService from '../services/unified-service';
import type { UnifiedModSearchResult, UnifiedVersion } from '../types/unified';
import type { ContentType as NrContentType, InstallContentPayload } from '../types/content';
import { logInfo } from './logging-utils';

export interface ProfileTarget {
  gameVersion: string;
  loader: string;
}

export interface VersionFilters {
  gameVersions?: string[] | null;
  loaders?: string[] | null;
}

export const paint = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export const hasFiles = (version?: UnifiedVersion | null): boolean =>
  !!version && Array.isArray(version.files) && version.files.length > 0;

export const primaryFileOf = (version: UnifiedVersion) =>
  version.files.find((f) => f.primary) ?? version.files[0];

export const minecraftVersionsOf = (version: UnifiedVersion): string[] =>
  (version.game_versions || []).filter((v) => /^[0-9]/.test(v));

export const newestMinecraftVersion = (version: UnifiedVersion): string | undefined =>
  [...minecraftVersionsOf(version)].sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  )[0];

export const supportsFabric = (version: UnifiedVersion): boolean =>
  (version.loaders || []).some((l) => l.toLowerCase() === 'fabric');

const SAME_RELEASE_MINUTES = 30;

const belongsToSameRelease = (a: UnifiedVersion, b: UnifiedVersion): boolean => {
  const apart = Math.abs(
    new Date(a.date_published).getTime() - new Date(b.date_published).getTime(),
  );
  if (Number.isNaN(apart) || apart > SAME_RELEASE_MINUTES * 60_000) return false;
  const versions = new Set(minecraftVersionsOf(b));
  return minecraftVersionsOf(a).some((v) => versions.has(v));
};

export const preferFabric = (
  candidates: UnifiedVersion[],
  newest: UnifiedVersion,
): UnifiedVersion => {
  if (supportsFabric(newest)) return newest;
  return candidates.find((v) => supportsFabric(v) && belongsToSameRelease(v, newest)) ?? newest;
};

export const fetchVersions = async (
  project: UnifiedModSearchResult | any,
): Promise<UnifiedVersion[]> => {
  const response = await UnifiedService.getModVersions({
    source: project.source,
    project_id: project.project_id,
  });
  if (!response.versions?.length) {
    throw new Error(`No versions found for ${project.title}`);
  }
  return response.versions;
};

export const selectVersion = (
  versions: UnifiedVersion[],
  filters: VersionFilters = {},
): UnifiedVersion | null => {
  let candidates = versions;

  if (filters.gameVersions?.length) {
    const wanted = filters.gameVersions;
    const matching = candidates.filter((v) =>
      (v.game_versions || []).some((g) => wanted.includes(g)),
    );
    if (matching.length > 0) candidates = matching;
  }

  if (filters.loaders?.length) {
    const wanted = filters.loaders.map((l) => l.toLowerCase());
    const matching = candidates.filter((v) =>
      (v.loaders || []).some((l) => wanted.includes(l.toLowerCase())),
    );
    if (matching.length > 0) candidates = matching;
  }

  const newest = [...candidates].sort((a, b) =>
    b.date_published.localeCompare(a.date_published),
  )[0];

  return newest ? preferFabric(candidates, newest) : null;
};

export const profileTargetFor = (version: UnifiedVersion): ProfileTarget => {
  const gameVersion = newestMinecraftVersion(version);
  if (!gameVersion) {
    throw new Error(`${version.version_number} names no Minecraft version`);
  }
  return {
    gameVersion,
    loader: supportsFabric(version)
      ? 'fabric'
      : (version.loaders || [])[0]?.toLowerCase() || 'vanilla',
  };
};

export async function resolveVersionFiles(
  project: UnifiedModSearchResult | any,
  version: UnifiedVersion,
  target: ProfileTarget,
): Promise<UnifiedVersion | null> {
  if (hasFiles(version)) return version;

  const response = await UnifiedService.getModVersions({
    source: project.source,
    project_id: project.project_id,
  });
  const versions = response.versions || [];
  const resolved =
    versions.find((v) => v.id === version.id && hasFiles(v)) ??
    versions.find(
      (v) =>
        hasFiles(v) &&
        (v.game_versions || []).includes(target.gameVersion) &&
        (v.loaders || []).some((l) => l.toLowerCase() === target.loader),
    ) ??
    null;

  logInfo(
    `[install] fetched files for ${version.version_number} -> ${resolved?.version_number ?? 'none'} (loaders=[${(resolved?.loaders || []).join(',')}])`,
  );
  return resolved;
}

export function buildInstallPayload(
  profileId: string,
  project: UnifiedModSearchResult | any,
  version: UnifiedVersion,
  contentType: NrContentType,
): InstallContentPayload {
  const file = primaryFileOf(version);
  return {
    profile_id: profileId,
    project_id: project.project_id,
    version_id: version.id,
    file_name: file.filename,
    download_url: file.url,
    file_hash_sha1: file.hashes?.sha1 || undefined,
    file_fingerprint: file.fingerprint ?? undefined,
    content_name: project.title,
    version_number: version.version_number,
    content_type: contentType,
    loaders: version.loaders,
    game_versions: version.game_versions,
    source: project.source,
  };
}
