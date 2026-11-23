import { useEffect, useState } from "react";
import { useLatest } from "./useLatest";
import * as ProfileService from "../services/profile-service";
import type { Profile } from "../types/profile";
import type { UnifiedVersion } from "../types/unified";

const PARALLEL_CHECKS = 12;

interface InstallTarget {
  project_id: string;
  project_type?: string;
}

export function useProfileInstallStatus(
  project: InstallTarget,
  version: UnifiedVersion | null | undefined,
  profiles: Profile[],
): Record<string, boolean> {
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const profileKey = profiles.map((p) => p.id).join(",");
  const latest = useLatest({ version, profiles });

  useEffect(() => {
    let cancelled = false;
    const { version, profiles } = latest.current;
    setInstalled({});
    const file = version ? version.files.find((f) => f.primary) ?? version.files[0] : undefined;
    const check = (profile: Profile) =>
      ProfileService.isContentInstalled({
        profile_id: profile.id,
        project_id: project.project_id,
        project_type: project.project_type,
        version_id: version?.id,
        game_version: version?.game_versions[0],
        loader: version?.loaders[0],
        file_hash_sha1: file?.hashes?.sha1,
        pack_version_number: version?.version_number,
        file_name: file?.filename,
      })
        .then((status) => !!status?.is_installed)
        .catch(() => false);

    (async () => {
      for (let i = 0; i < profiles.length && !cancelled; i += PARALLEL_CHECKS) {
        const chunk = profiles.slice(i, i + PARALLEL_CHECKS);
        const results = await Promise.all(chunk.map(check));
        if (cancelled) return;
        const hits = chunk.filter((_, index) => results[index]);
        if (hits.length > 0) {
          setInstalled((prev) => ({ ...prev, ...Object.fromEntries(hits.map((p) => [p.id, true])) }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [project.project_id, project.project_type, version?.id, profileKey, latest]);

  return installed;
}
