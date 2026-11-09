import type { Profile } from "../types/profile";

const timeOf = (value: string | null | undefined) => (value ? new Date(value).getTime() || 0 : 0);

export function compareByLastPlayed(a: Profile, b: Profile): number {
  return (
    timeOf(b.last_played) - timeOf(a.last_played) ||
    timeOf(b.created) - timeOf(a.created) ||
    a.name.localeCompare(b.name)
  );
}
