import { useMemo } from "react";
import { useProfileStore } from "../../../store/profile-store";
import { compareByLastPlayed } from "../../../utils/profile-sort";
import type { Profile } from "../../../types/profile";

export function useRecentProfiles(count: number): Profile[] {
  const profiles = useProfileStore((state) => state.profiles);
  return useMemo(
    () => profiles.filter((profile) => profile.last_played).sort(compareByLastPlayed).slice(0, count),
    [profiles, count],
  );
}
