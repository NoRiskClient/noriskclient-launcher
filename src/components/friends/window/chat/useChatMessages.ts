import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useFriendsStore } from "../../../../store/friends-store";
import { messageTime, useChatStore, type ChatMessage } from "../../../../store/chat-store";
import { translateApiError } from "../../../../utils/nrc-error-translations";
import { getChatMessages, getOrCreateChat, sendChatMessage, type ChatInfo } from "../../../../services/chat-service";
import { mergeMessages, sortByTime } from "./message-rows";

/** The friends socket is disabled, so an open chat polls. */
const POLL_MS = 5000;

export interface ChatScrollHooks {
  /** Before content lands above the reader. */
  beforeOlder: () => void;
  /** Before new messages land below. */
  beforeNewer: () => void;
  /** After the player sent a message. */
  afterSend: () => void;
}

/** Loads, pages, polls and sends one friend chat, and marks what is shown as read. */
export function useChatMessages(friendUuid: string, scroll: ChatScrollHooks) {
  const wsConnected = useFriendsStore((s) => s.wsConnected);
  const markChatRead = useChatStore((s) => s.markChatRead);
  const setLatestMessage = useChatStore((s) => s.setLatestMessage);

  const [chat, setChat] = useState<ChatInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [olderFailed, setOlderFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const pageRef = useRef(1);
  // Latest callbacks, without re-running the effects.
  const scrollRef = useRef(scroll);
  scrollRef.current = scroll;

  useEffect(() => {
    let cancelled = false;
    setChat(null);
    setMessages([]);
    setLoading(true);
    setLoadError(null);
    setHasMore(true);
    setOlderFailed(false);
    pageRef.current = 1;

    (async () => {
      try {
        const info = await getOrCreateChat(friendUuid);
        if (cancelled) return;
        const first = await getChatMessages(info._id, 1);
        if (cancelled) return;
        setChat(info);
        setMessages(sortByTime(first.filter(Boolean)));
        setHasMore(first.length > 0);
      } catch (e) {
        if (!cancelled) setLoadError(translateApiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [friendUuid, reloadKey]);

  useEffect(() => {
    if (!chat) return;
    const offs = [
      listen<ChatMessage>("chat:message_received", (event) => {
        if (event.payload?.chatId !== chat._id) return;
        scrollRef.current.beforeNewer();
        setMessages((prev) => mergeMessages(prev, [event.payload]));
      }),
      listen<ChatMessage>("chat:message_updated", (event) => {
        if (event.payload?.chatId !== chat._id) return;
        setMessages((prev) => mergeMessages(prev, [event.payload]));
      }),
    ];
    return () => {
      offs.forEach((off) => off.then((fn) => fn()));
    };
  }, [chat]);

  // No socket: poll while the window is visible.
  useEffect(() => {
    if (!chat || wsConnected) return;
    let busy = false;
    const id = window.setInterval(async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const latest = await getChatMessages(chat._id, 1);
        scrollRef.current.beforeNewer();
        setMessages((prev) => mergeMessages(prev, latest));
      } catch {
        // Retried on the next tick.
      } finally {
        busy = false;
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [chat, wsConnected]);

  // What is shown counts as read; the chat list preview follows.
  const newest = messages[messages.length - 1];
  useEffect(() => {
    if (!chat || !newest) return;
    setLatestMessage(chat._id, newest);
    markChatRead(chat._id, messageTime(newest));
  }, [chat, newest, setLatestMessage, markChatRead]);

  const loadMore = useCallback(async () => {
    if (!chat || loadingMore || !hasMore || olderFailed) return;
    scrollRef.current.beforeOlder();
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const older = (await getChatMessages(chat._id, next)).filter(Boolean);
      scrollRef.current.beforeOlder();
      if (older.length === 0) {
        setHasMore(false);
        return;
      }
      pageRef.current = next;
      setMessages((prev) => mergeMessages(prev, older));
    } catch {
      // Not the start of the chat, so offer a retry.
      scrollRef.current.beforeOlder();
      setOlderFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [chat, loadingMore, hasMore, olderFailed]);

  const retryOlder = useCallback(() => setOlderFailed(false), []);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  /** Throws when the API refuses the message. */
  const send = useCallback(
    async (content: string) => {
      if (!chat) throw new Error("The chat is not open yet");
      const sent = await sendChatMessage(chat._id, content);
      scrollRef.current.afterSend();
      setMessages((prev) => mergeMessages(prev, [sent]));
    },
    [chat],
  );

  return {
    chat,
    messages,
    loading,
    loadError,
    reload,
    loadingMore,
    hasMore,
    olderFailed,
    loadMore,
    retryOlder,
    send,
  };
}
