import { useEffect, useRef, useState, useMemo, useCallback, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { useFriendsStore, FriendsFriendUser } from "../../store/friends-store";
import { useThemeStore } from "../../store/useThemeStore";
import { useCrafatarAvatar } from "../../hooks/useCrafatarAvatar";

function getDateLabel(timestamp: number, t: (key: string) => string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (messageDate.getTime() === today.getTime()) {
    return t('chat.today');
  } else if (messageDate.getTime() === yesterday.getTime()) {
    return t('chat.yesterday');
  } else {
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: messageDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  }
}

interface MessageReaction {
  emoji: string;
  reactor: string;
}

interface Message {
  _id: string;
  chatId: string;
  senderId: string;
  content: string;
  createdAt?: number;
  sentAt?: number;
  receivedAt?: number;
  readAt?: number;
  editedAt?: number;
  deletedAt?: number;
  reactions: MessageReaction[];
  relatesTo?: string;
  timestamp?: number;
}

interface ChatParticipant {
  userId: string;
  joinedAt: number;
  role?: string;
}

interface ChatInfo {
  _id: string;
  participants: ChatParticipant[];
  type?: string;
  name?: string;
  timestamp?: number;
}

interface ChatPanelProps {
  friend: FriendsFriendUser;
}

const MESSAGES_PER_PAGE = 5; // Backend pageSize

export function ChatPanel({ friend }: ChatPanelProps) {
  const { t } = useTranslation();
  const { accentColor } = useThemeStore();
  const { closeChat, currentUser } = useFriendsStore();
  const [chat, setChat] = useState<ChatInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const avatarUrl = useCrafatarAvatar({ uuid: friend.uuid, size: 20 });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const scrollDistanceFromBottom = useRef<number>(0);
  const shouldRestoreScroll = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const initChat = async () => {
      setChat(null);
      setMessages([]);
      setIsLoading(true);
      setIsLoadingMore(false);
      setHasMore(true);
      setCurrentPage(1);

      try {
        const chatData = await invoke<ChatInfo>("get_or_create_chat", {
          friendUuid: friend.uuid,
        });
        if (cancelled) return;
        setChat(chatData);

        const messagesData = await invoke<Message[]>("get_chat_messages", {
          chatId: chatData._id,
          page: 1,
        });
        if (cancelled) return;

        if (messagesData.length < MESSAGES_PER_PAGE) {
          setHasMore(false);
        }

        const sorted = [...messagesData].sort((a, b) => {
          const timeA = a.createdAt || a.sentAt || a.timestamp || 0;
          const timeB = b.createdAt || b.sentAt || b.timestamp || 0;
          return timeA - timeB;
        });
        setMessages(sorted);

        requestAnimationFrame(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
        });
      } catch (e) {
        console.error("Failed to init chat:", e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    initChat();
    return () => { cancelled = true; };
  }, [friend.uuid]);

  useEffect(() => {
    if (!chat?._id) return;

    const unlistenMessage = listen<Message>(
      "chat:message_received",
      (event) => {
        const msg = event.payload;
        if (msg.chatId === chat._id && msg._id) {
          setMessages((prev) => {
            if (prev.some((m) => m._id === msg._id)) {
              return prev;
            }
            return [...prev, msg];
          });
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
          }, 50);
        }
      }
    );

    const unlistenMessageUpdated = listen<Message>(
      "chat:message_updated",
      (event) => {
        if (event.payload.chatId === chat._id) {
          setMessages((prev) => {
            const exists = prev.some((m) => m._id === event.payload._id);
            if (exists) {
              return prev.map((m) =>
                m._id === event.payload._id ? event.payload : m
              );
            }
            return [...prev, event.payload];
          });
        }
      }
    );

    return () => {
      unlistenMessage.then((fn) => fn());
      unlistenMessageUpdated.then((fn) => fn());
    };
  }, [chat?._id]);

  const loadMoreMessages = useCallback(async () => {
    if (!chat || isLoadingMore || !hasMore) return;

    // Store distance from bottom to restore scroll position later
    const container = messagesContainerRef.current;
    if (container) {
      scrollDistanceFromBottom.current = container.scrollHeight - container.scrollTop;
    }

    setIsLoadingMore(true);

    try {
      const nextPage = currentPage + 1;
      const messagesData = await invoke<Message[]>("get_chat_messages", {
        chatId: chat._id,
        page: nextPage,
      });

      if (messagesData.length === 0) {
        setHasMore(false);
        setIsLoadingMore(false);
        return;
      }

      if (messagesData.length < MESSAGES_PER_PAGE) {
        setHasMore(false);
      }

      setCurrentPage(nextPage);

      const existingIds = new Set(messages.map((m) => m._id));
      const newMessages = messagesData.filter((m) => !existingIds.has(m._id));

      if (newMessages.length === 0) {
        setHasMore(false);
        setIsLoadingMore(false);
        return;
      }

      const merged = [...newMessages, ...messages].sort((a, b) => {
        const timeA = a.createdAt || a.sentAt || a.timestamp || 0;
        const timeB = b.createdAt || b.sentAt || b.timestamp || 0;
        return timeA - timeB;
      });

      shouldRestoreScroll.current = true;
      setMessages(merged);
    } catch (e) {
      console.error("Failed to load more messages:", e);
      setIsLoadingMore(false);
    }
  }, [chat, isLoadingMore, hasMore, currentPage, messages]);

  // Restore scroll position synchronously before paint (bottom anchoring)
  useLayoutEffect(() => {
    if (!shouldRestoreScroll.current) return;

    const container = messagesContainerRef.current;
    if (!container) return;

    container.scrollTop = container.scrollHeight - scrollDistanceFromBottom.current;

    shouldRestoreScroll.current = false;
    scrollDistanceFromBottom.current = 0;
    setIsLoadingMore(false);
  }, [messages]);

  const lastLoadTimeRef = useRef(0);
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const now = Date.now();
    if (target.scrollTop < 100 && hasMore && !isLoadingMore && now - lastLoadTimeRef.current > 500) {
      lastLoadTimeRef.current = now;
      loadMoreMessages();
    }
  }, [hasMore, isLoadingMore, loadMoreMessages]);

  // IntersectionObserver for loading more messages when top sentinel is visible
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel || !hasMore || isLoading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          loadMoreMessages();
        }
      },
      {
        root: messagesContainerRef.current,
        rootMargin: "100px 0px 0px 0px",
        threshold: 0,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, isLoading, loadMoreMessages]);

  const handleSend = async (content: string) => {
    if (!chat) return;

    try {
      const sentMessage = await invoke<Message>("send_chat_message", {
        chatId: chat._id,
        content,
      });

      // Add message to local list immediately (don't wait for WebSocket)
      setMessages((prev) => {
        if (prev.some((m) => m._id === sentMessage._id)) {
          return prev;
        }
        return [...prev, sentMessage];
      });

      // Scroll to bottom
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    } catch (e) {
      console.error("Failed to send message:", e);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col">
        {/* Skeleton Header */}
        <div
          className="flex items-center justify-between px-3 py-2.5 shrink-0"
          style={{
            borderBottom: `1px solid ${accentColor.value}40`,
            background: `linear-gradient(90deg, ${accentColor.value}20, ${accentColor.value}10)`,
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-7 h-7 rounded-lg"
              style={{ backgroundColor: `${accentColor.value}30` }}
            />
            <div
              className="w-7 h-7 rounded-lg"
              style={{ backgroundColor: `${accentColor.value}20` }}
            />
            <div
              className="h-4 w-24 rounded"
              style={{ backgroundColor: `${accentColor.value}20` }}
            />
          </div>
        </div>

        {/* Skeleton Messages */}
        <div className="flex-1 overflow-hidden py-3">
          {[80, 65, 90, 70, 85].map((width, i) => (
            <div key={i} className="flex gap-3 px-3 py-1 mb-2">
              <div
                className="w-8 h-8 rounded-md shrink-0"
                style={{ backgroundColor: `${accentColor.value}15` }}
              />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <div
                    className="h-3 rounded"
                    style={{
                      backgroundColor: `${accentColor.value}20`,
                      width: `${width}px`,
                    }}
                  />
                  <div
                    className="h-2 w-12 rounded"
                    style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
                  />
                </div>
                <div
                  className="h-4 rounded"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.08)",
                    width: `${40 + width / 3}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Skeleton Input */}
        <div className="px-3 py-2 shrink-0">
          <div
            className="h-10 rounded-lg"
            style={{ backgroundColor: `${accentColor.value}10` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div
        className="flex items-center justify-between px-3 py-2.5 shrink-0"
        style={{
          borderBottom: `1px solid ${accentColor.value}40`,
          background: `linear-gradient(90deg, ${accentColor.value}20, ${accentColor.value}10)`,
        }}
      >
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={friend.username}
              className="w-7 h-7 rounded-lg"
              style={{ border: `2px solid ${accentColor.value}50` }}
            />
          ) : (
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{
                backgroundColor: `${accentColor.value}30`,
                border: `2px solid ${accentColor.value}50`,
              }}
            >
              <Icon
                icon="solar:user-bold"
                className="w-4 h-4"
                style={{ color: accentColor.value }}
              />
            </div>
          )}
          <span className="text-sm font-medium text-white font-minecraft-ten truncate">
            {friend.username}
          </span>
        </div>
        <button
          onClick={closeChat}
          className="p-1.5 rounded-lg transition-all duration-200"
          style={{
            backgroundColor: `${accentColor.value}20`,
            color: accentColor.value,
          }}
        >
          <Icon icon="solar:close-circle-bold" className="w-4 h-4" />
        </button>
      </div>

      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto py-3 custom-scrollbar flex flex-col"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
              style={{
                backgroundColor: `${accentColor.value}15`,
                border: `1px solid ${accentColor.value}40`,
              }}
            >
              <Icon
                icon="solar:chat-round-line-linear"
                className="w-6 h-6"
                style={{ color: accentColor.value }}
              />
            </div>
            <p className="text-white/50 text-xs font-minecraft-ten">{t('chat.no_messages_title')}</p>
            <p className="text-white/30 text-xl mt-1 font-minecraft">{t('chat.no_messages_desc')}</p>
          </div>
        ) : (
          <>
            {/* Spacer to push content to bottom */}
            <div className="flex-1" />
            {/* Top sentinel for IntersectionObserver */}
            <div ref={topSentinelRef} className="h-1" />
            {isLoadingMore && (
              <div className="flex justify-center py-3">
                <Icon
                  icon="solar:refresh-linear"
                  className="w-5 h-5 animate-spin"
                  style={{ color: accentColor.value }}
                />
              </div>
            )}
            {!hasMore && !isLoadingMore && (
              <div className="flex justify-center py-2">
                <span className="text-xs font-minecraft-ten text-white/30">
                  {t('chat.start_of_conversation')}
                </span>
              </div>
            )}
            {messages.filter((m) => m != null).map((message, index, arr) => {
              const timestamp = message.createdAt || message.sentAt || message.timestamp || 0;
              const prevMessage = arr[index - 1];
              const prevTimestamp = prevMessage ? (prevMessage.createdAt || prevMessage.sentAt || prevMessage.timestamp || 0) : 0;

              const showDateSeparator = index === 0 ||
                getDateLabel(timestamp, t) !== getDateLabel(prevTimestamp, t);

              // Discord-style: show header if different sender or > 5 min gap
              const isNewGroup = !prevMessage ||
                prevMessage.senderId !== message.senderId ||
                (timestamp - prevTimestamp) > 5 * 60 * 1000 ||
                showDateSeparator;

              return (
                <div key={message._id} data-message-id={message._id}>
                  {showDateSeparator && (
                    <div className="flex items-center justify-center py-3 my-1">
                      <div
                        className="px-3 py-1 rounded-full text-[10px] font-minecraft-ten uppercase tracking-wider"
                        style={{
                          backgroundColor: `${accentColor.value}15`,
                          color: `${accentColor.value}90`,
                          border: `1px solid ${accentColor.value}30`,
                        }}
                      >
                        {getDateLabel(timestamp, t)}
                      </div>
                    </div>
                  )}
                  <ChatMessage
                    message={message}
                    isOwn={message.senderId === currentUser?.uuid}
                    friendUuid={friend.uuid}
                    friendName={friend.username}
                    currentUserUuid={currentUser?.uuid}
                    currentUserName={currentUser?.username}
                    accentColor={accentColor.value}
                    showHeader={isNewGroup}
                  />
                </div>
              );
            })}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        onSend={handleSend}
        accentColor={accentColor.value}
      />
    </div>
  );
}
