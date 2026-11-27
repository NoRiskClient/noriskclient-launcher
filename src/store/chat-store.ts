import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface ChatParticipant {
  userId: string;
  joinedAt: number;
  role?: string;
}

export interface ChatMessageReaction {
  emoji: string;
  reactor: string;
}

export interface ChatMessage {
  _id: string;
  chatId: string;
  senderId: string;
  content: string;
  relatesTo?: string;
  createdAt?: number;
  sentAt?: number;
  receivedAt?: number;
  readAt?: number;
  editedAt?: number;
  deletedAt?: number;
  reactions: ChatMessageReaction[];
  timestamp?: number;
}

export interface ComputedChat {
  _id: string;
  participants: ChatParticipant[];
  type?: string;
  name?: string;
  timestamp?: number;
  groupAvatarUrl?: string;
  unreadMessages: number;
  latestMessage?: ChatMessage;
}

/** The time a message was written, whichever field the backend filled in. */
export function messageTime(message: Pick<ChatMessage, 'createdAt' | 'sentAt' | 'timestamp'> | undefined): number {
  if (!message) return 0;
  return message.createdAt || message.sentAt || message.timestamp || 0;
}

/** Per chat, the time of the newest message seen. */
export type ReadUpTo = Record<string, number>;

// The API has no read receipts; both windows share what was seen through localStorage.
const READ_KEY = 'norisk-chat-read';

function loadReadUpTo(): ReadUpTo {
  try {
    const value = JSON.parse(localStorage.getItem(READ_KEY) ?? '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function saveReadUpTo(readUpTo: ReadUpTo) {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(readUpTo));
  } catch {
    // Without storage, only this window forgets the count.
  }
}

/**
 * The API counts deleted messages and knows nothing of what was read here, so a chat shows no
 * count when its newest message is gone, deleted, the player's own, or already seen.
 */
export function visibleUnread(chat: ComputedChat, me: string | undefined, readUpTo: ReadUpTo): number {
  const count = chat.unreadMessages || 0;
  if (count <= 0) return 0;
  const latest = chat.latestMessage;
  if (!latest || latest.deletedAt) return 0;
  if (me && latest.senderId?.toLowerCase() === me.toLowerCase()) return 0;
  const seen = readUpTo[chat._id];
  if (seen !== undefined && messageTime(latest) <= seen) return 0;
  return count;
}

interface ChatState {
  chats: ComputedChat[];
  error: string | null;
  readUpTo: ReadUpTo;

  loadChats: () => Promise<void>;
  /** Marks the chat as seen up to the message written at `upTo`. */
  markChatRead: (chatId: string, upTo: number) => void;
  /** Moves a message into the chat list preview without waiting for a refetch. */
  setLatestMessage: (chatId: string, message: ChatMessage) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  error: null,
  readUpTo: loadReadUpTo(),

  loadChats: async () => {
    try {
      const chats = await invoke<ComputedChat[]>('get_private_chats');
      set({ chats });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  markChatRead: (chatId: string, upTo: number) => {
    const seen = get().readUpTo[chatId];
    if (seen !== undefined && seen >= upTo) return;
    // Merge with storage, so the other window's marks survive.
    const readUpTo = { ...loadReadUpTo(), [chatId]: upTo };
    saveReadUpTo(readUpTo);
    set({ readUpTo });
  },

  setLatestMessage: (chatId: string, message: ChatMessage) => {
    set((s) => ({
      chats: s.chats.map((c) =>
        c._id === chatId && messageTime(message) >= messageTime(c.latestMessage)
          ? { ...c, latestMessage: message }
          : c,
      ),
    }));
  },
}));

// Follow chats read in the other window.
window.addEventListener('storage', (event) => {
  if (event.key === READ_KEY) useChatStore.setState({ readUpTo: loadReadUpTo() });
});
