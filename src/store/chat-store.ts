import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface ChatParticipant {
  userId: string;
  joinedAt: number;
  role?: string;
}

export interface Chat {
  _id: string;
  participants: ChatParticipant[];
  type?: string;
  name?: string;
  timestamp?: number;
  groupAvatarUrl?: string;
  unreadMessages?: number;
  latestMessage?: ChatMessage;
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
  activeChat: Chat | null;
  activeFriend: { uuid: string; username: string } | null;
  messages: ChatMessage[];
  chats: ComputedChat[];
  isLoading: boolean;
  typingUsers: Set<string>;
  error: string | null;

  setActiveChat: (chat: Chat, friend: { uuid: string; username: string }) => void;
  clearActiveChat: () => void;

  loadChats: () => Promise<void>;
  loadMessages: (chatId: string, page?: number) => Promise<void>;
  sendMessage: (chatId: string, content: string, relatesTo?: string) => Promise<ChatMessage>;
  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;

  sendTypingIndicator: (chatId: string) => Promise<void>;
  addTypingUser: (chatId: string, uuid: string) => void;
  removeTypingUser: (chatId: string, uuid: string) => void;

  addMessage: (message: ChatMessage) => void;
  updateMessage: (message: ChatMessage) => void;
  removeMessage: (messageId: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  activeChat: null,
  activeFriend: null,
  messages: [],
  chats: [],
  isLoading: false,
  typingUsers: new Set(),
  error: null,

  setActiveChat: (chat, friend) => {
    set({ activeChat: chat, activeFriend: friend, messages: [] });
  },

  clearActiveChat: () => {
    set({ activeChat: null, activeFriend: null, messages: [], typingUsers: new Set() });
  },

  loadChats: async () => {
    try {
      const chats = await invoke<ComputedChat[]>('get_private_chats');
      console.log("[ChatStore] loadChats response:", chats);
      chats.forEach(c => {
        console.log("[ChatStore] Chat:", c._id, "participants:", c.participants, "unreadMessages:", c.unreadMessages);
      });
      set({ chats });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadMessages: async (chatId: string, page: number = 0) => {
    set({ isLoading: true, error: null });
    try {
      const messages = await invoke<ChatMessage[]>('get_chat_messages', { chatId, page });
      if (page === 0) {
        set({ messages: messages.reverse(), isLoading: false });
      } else {
        set((s) => ({
          messages: [...messages.reverse(), ...s.messages],
          isLoading: false,
        }));
      }
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  sendMessage: async (chatId: string, content: string, relatesTo?: string) => {
    try {
      const message = await invoke<ChatMessage>('send_chat_message', {
        chatId,
        content,
        relatesTo: relatesTo || null,
      });
      set((s) => ({ messages: [...s.messages, message] }));
      return message;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  editMessage: async (messageId: string, content: string) => {
    try {
      const message = await invoke<ChatMessage>('edit_chat_message', { messageId, content });
      set((s) => ({
        messages: s.messages.map((m) => (m._id === messageId ? message : m)),
      }));
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  deleteMessage: async (messageId: string) => {
    try {
      await invoke('delete_chat_message', { messageId });
      set((s) => ({
        messages: s.messages.filter((m) => m._id !== messageId),
      }));
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  sendTypingIndicator: async (chatId: string) => {
    try {
      await invoke('send_typing_indicator', { chatId });
    } catch (e) {
      console.error('Failed to send typing indicator:', e);
    }
  },

  addTypingUser: (chatId: string, uuid: string) => {
    const { activeChat } = get();
    if (activeChat?._id === chatId) {
      set((s) => ({
        typingUsers: new Set([...s.typingUsers, uuid]),
      }));
    }
  },

  removeTypingUser: (chatId: string, uuid: string) => {
    const { activeChat } = get();
    if (activeChat?._id === chatId) {
      set((s) => {
        const newSet = new Set(s.typingUsers);
        newSet.delete(uuid);
        return { typingUsers: newSet };
      });
    }
  },

  addMessage: (message: ChatMessage) => {
    const { activeChat } = get();
    if (activeChat?._id === message.chatId) {
      set((s) => ({ messages: [...s.messages, message] }));
    }
  },

  updateMessage: (message: ChatMessage) => {
    set((s) => ({
      messages: s.messages.map((m) => (m._id === message._id ? message : m)),
    }));
  },

  removeMessage: (messageId: string) => {
    set((s) => ({
      messages: s.messages.filter((m) => m._id !== messageId),
    }));
  },
}));
