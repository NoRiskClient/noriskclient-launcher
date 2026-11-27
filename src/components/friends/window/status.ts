import type { OnlineState } from "../../../store/friends-store";

interface StatusMeta {
  color: string;
  labelKey: string;
}

const STATUS: Record<OnlineState, StatusMeta> = {
  ONLINE: { color: "var(--fw-online)", labelKey: "friends.status.online" },
  AFK: { color: "var(--fw-away)", labelKey: "friends.status.away" },
  BUSY: { color: "var(--fw-busy)", labelKey: "friends.status.busy" },
  OFFLINE: { color: "var(--fw-offline)", labelKey: "friends.status.offline" },
  INVISIBLE: { color: "var(--fw-offline)", labelKey: "friends.status.invisible" },
};

/** Statuses the player can pick for themselves. */
export const SELECTABLE_STATUSES: OnlineState[] = ["ONLINE", "AFK", "BUSY", "INVISIBLE"];

export function isOnlineState(state: OnlineState | undefined): boolean {
  return state === "ONLINE" || state === "AFK" || state === "BUSY";
}

/** Invisible friends show as offline; only your own status reads "Invisible". */
export function statusMeta(state: OnlineState, self = false): StatusMeta {
  if (state === "INVISIBLE" && !self) return STATUS.OFFLINE;
  return STATUS[state] ?? STATUS.OFFLINE;
}
