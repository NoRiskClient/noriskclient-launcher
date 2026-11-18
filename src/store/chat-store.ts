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

interface ChatState {
  chats: ComputedChat[];
  error: string | null;

  loadChats: () => Promise<void>;
}

export const useChatStore = create<ChatState>((set) => ({
  chats: [],
  error: null,

  loadChats: async () => {
    try {
      const chats = await invoke<ComputedChat[]>('get_private_chats');
      set({ chats });
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
