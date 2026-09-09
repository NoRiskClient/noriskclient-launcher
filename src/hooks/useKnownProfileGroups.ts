import { useMemo } from "react";

import { useProfileStore } from "../store/profile-store";

export function useKnownProfileGroups(extra: (string | null | undefined)[] = []): string[] {
  const profiles = useProfileStore((state) => state.profiles);
  const extraKey = JSON.stringify(extra.filter(Boolean));

  return useMemo(() => {
    const groups = new Set<string>();
    for (const profile of profiles) {
      if (profile.group) groups.add(profile.group);
    }
    for (const value of JSON.parse(extraKey) as string[]) {
      groups.add(value);
    }
    return [...groups].sort((a, b) => a.localeCompare(b));
  }, [profiles, extraKey]);
}
