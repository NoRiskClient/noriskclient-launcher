import type { FriendsFriendUser, LoginStreak } from "../../../../store/friends-store";
import { formatRelativeTime } from "../../../../utils/format-relative-time";

export interface ProfileRow {
  icon: string;
  label: string;
  value: string;
  accent?: boolean;
}

export interface ProfileSummary {
  streak: { running: number; best: number } | null;
  rows: ProfileRow[];
}

/** "CONTENT_CREATOR" reads as "Content Creator". */
export function formatRank(rank: string): string {
  return rank
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function localDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A streak only counts if it ran today or yesterday. */
export function runningStreak(streak: LoginStreak | null | undefined): number {
  if (!streak?.days || !streak.lastDay) return 0;
  return streak.lastDay >= localDay(-1) ? streak.days : 0;
}

/** What the chat header does not show; null when there is nothing. */
export function profileSummary(
  friend: FriendsFriendUser,
  online: boolean,
  t: (key: string) => string,
): ProfileSummary | null {
  const rows: ProfileRow[] = [];
  if (!online && friend.lastSeenAt) {
    rows.push({
      icon: "solar:clock-circle-bold",
      label: t("friends.profile_last_seen"),
      value: formatRelativeTime(new Date(friend.lastSeenAt).toISOString()),
    });
  }
  if (friend.rank && friend.rank.toUpperCase() !== "DEFAULT") {
    rows.push({ icon: "solar:shield-star-bold", label: t("friends.profile_rank"), value: formatRank(friend.rank) });
  }
  if (friend.noriskPlus) {
    rows.push({ icon: "solar:crown-bold", label: "NoRisk+", value: t("friends.profile_plus_active"), accent: true });
  }
  const best = friend.loginStreak?.maxDays ?? 0;
  const streak = best > 0 ? { running: runningStreak(friend.loginStreak), best } : null;
  if (!streak && rows.length === 0) return null;
  return { streak, rows };
}
