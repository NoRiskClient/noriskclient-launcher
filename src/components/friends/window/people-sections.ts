import type { FriendsFriendUser } from "../../../store/friends-store";
import { messageTime, visibleUnread, type ComputedChat, type ReadUpTo } from "../../../store/chat-store";
import { isOnlineState } from "./status";

export type SectionKey = "recent" | "friends";

export interface SectionRow {
  friend: FriendsFriendUser;
  chat?: ComputedChat;
  unread: number;
}

export interface PeopleSection {
  key: SectionKey;
  rows: SectionRow[];
  online: number;
}

/** Recent chats shown above the friend list. */
const RECENT_LIMIT = 8;

const byStatusThenName = (a: FriendsFriendUser, b: FriendsFriendUser) => {
  const online = Number(isOnlineState(b.state)) - Number(isOnlineState(a.state));
  return online || a.username.localeCompare(b.username, undefined, { sensitivity: "base" });
};

interface PeopleInput {
  friends: FriendsFriendUser[];
  chats: ComputedChat[];
  readUpTo: ReadUpTo;
  me: string | undefined;
  query: string;
}

/** Recent chats, then everyone else; each friend appears once. */
export function buildPeopleSections({ friends, chats, readUpTo, me, query }: PeopleInput): PeopleSection[] {
  const self = me?.toLowerCase();
  const q = query.trim().toLowerCase();
  const matches = (f: FriendsFriendUser) => !q || f.username.toLowerCase().includes(q);
  const byUuid = new Map(friends.filter(Boolean).map((f) => [f.uuid.toLowerCase(), f]));
  const placed = new Set<string>();

  const chatFor = new Map<string, ComputedChat>();
  for (const chat of chats) {
    const other = chat.participants.find((p) => p.userId.toLowerCase() !== self);
    if (other) chatFor.set(other.userId.toLowerCase(), chat);
  }
  const row = (friend: FriendsFriendUser): SectionRow => {
    const chat = chatFor.get(friend.uuid.toLowerCase());
    return { friend, chat, unread: chat ? visibleUnread(chat, self, readUpTo) : 0 };
  };

  const recentRows = [...chatFor.entries()]
    .filter(([, chat]) => chat.latestMessage)
    .map(([uuid]) => byUuid.get(uuid))
    .filter((f): f is FriendsFriendUser => !!f && matches(f))
    .map(row)
    .sort((a, b) => messageTime(b.chat?.latestMessage) - messageTime(a.chat?.latestMessage))
    .slice(0, q ? undefined : RECENT_LIMIT);
  recentRows.forEach((r) => placed.add(r.friend.uuid.toLowerCase()));

  const friendRows = [...byUuid.values()]
    .filter((f) => !placed.has(f.uuid.toLowerCase()) && matches(f))
    .sort(byStatusThenName)
    .map(row);

  const online = (rows: SectionRow[]) => rows.filter((r) => isOnlineState(r.friend.state)).length;
  return [
    { key: "recent", rows: recentRows, online: online(recentRows) },
    { key: "friends", rows: friendRows, online: online(friendRows) },
  ];
}
