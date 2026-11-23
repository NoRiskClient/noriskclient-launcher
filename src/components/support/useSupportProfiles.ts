import { useEffect, useMemo, useState } from "react";
import { useProfileStore } from "../../store/profile-store";
import { sortRecentFirst } from "../../utils/profile-sort";

export function useSupportProfiles() {
  const profiles = useProfileStore((s) => s.profiles);
  const lastPlayedProfileId = useProfileStore((s) => s.lastPlayedProfileId);
  const loading = useProfileStore((s) => s.loading);
  const fetchProfiles = useProfileStore((s) => s.fetchProfiles);

  useEffect(() => {
    if (useProfileStore.getState().profiles.length === 0) fetchProfiles();
  }, [fetchProfiles]);

  const sorted = useMemo(() => sortRecentFirst(profiles, lastPlayedProfileId), [profiles, lastPlayedProfileId]);

  const [profileId, setProfileId] = useState<string | null>(null);
  useEffect(() => {
    if (profileId && profiles.some((p) => p.id === profileId)) return;
    if (sorted.length > 0) setProfileId(sorted[0].id);
  }, [profiles, sorted, profileId]);

  return {
    sorted,
    ready: !loading || profiles.length > 0,
    lastPlayedProfileId,
    profileId,
    setProfileId,
    profile: profiles.find((p) => p.id === profileId) ?? null,
  };
}

export type SupportProfiles = ReturnType<typeof useSupportProfiles>;
