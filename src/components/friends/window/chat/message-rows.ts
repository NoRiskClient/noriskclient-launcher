import { messageTime, type ChatMessage } from "../../../../store/chat-store";
import { isSameDay } from "../time";

/** Messages closer together than this from one sender read as one block. */
const GROUP_GAP_MS = 5 * 60 * 1000;

export function sortByTime(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((a, b) => messageTime(a) - messageTime(b));
}

/** Merges by id. Returns `current` itself when nothing changed, so idle polls skip a render. */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((m) => [m._id, m]));
  let changed = false;
  for (const m of incoming) {
    if (!m?._id) continue;
    const prev = byId.get(m._id);
    if (!prev || prev.content !== m.content || prev.editedAt !== m.editedAt || prev.deletedAt !== m.deletedAt) {
      byId.set(m._id, m);
      changed = true;
    }
  }
  return changed ? sortByTime([...byId.values()]) : current;
}

export interface MessageRowData {
  message: ChatMessage;
  ts: number;
  /** First message of its day, so it gets a day heading. */
  newDay: boolean;
  /** First and last message of a group from one sender. */
  first: boolean;
  last: boolean;
  own: boolean;
}

function startsGroup(prev: ChatMessage | undefined, message: ChatMessage): boolean {
  if (!prev) return true;
  const ts = messageTime(message);
  const prevTs = messageTime(prev);
  return !isSameDay(prevTs, ts) || prev.senderId !== message.senderId || ts - prevTs > GROUP_GAP_MS;
}

export function buildMessageRows(messages: ChatMessage[], me: string | undefined): MessageRowData[] {
  const self = me?.toLowerCase();
  return messages.map((message, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const ts = messageTime(message);
    return {
      message,
      ts,
      newDay: !prev || !isSameDay(messageTime(prev), ts),
      first: startsGroup(prev, message),
      last: !next || startsGroup(message, next),
      own: message.senderId?.toLowerCase() === self,
    };
  });
}
