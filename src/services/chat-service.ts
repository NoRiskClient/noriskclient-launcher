import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../store/chat-store";

export interface ChatInfo {
  _id: string;
}

/** The private chat with a friend, created on first use. */
export const getOrCreateChat = (friendUuid: string): Promise<ChatInfo> =>
  invoke("get_or_create_chat", { friendUuid });

/** Page 1 is the newest. */
export const getChatMessages = (chatId: string, page: number): Promise<ChatMessage[]> =>
  invoke("get_chat_messages", { chatId, page });

export const sendChatMessage = (chatId: string, content: string): Promise<ChatMessage> =>
  invoke("send_chat_message", { chatId, content });
