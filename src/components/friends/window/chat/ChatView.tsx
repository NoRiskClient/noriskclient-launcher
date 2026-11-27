import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useFriendsStore, type FriendsFriendUser } from "../../../../store/friends-store";
import { toast } from "../../../ui/GlobalToaster";
import { translateApiError } from "../../../../utils/nrc-error-translations";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { ConversationStart, MessageRow, MessagesSkeleton } from "./MessageRow";
import { buildMessageRows } from "./message-rows";
import { useChatMessages } from "./useChatMessages";

const NEAR_BOTTOM_PX = 120;

/** The open chat. Data comes from `useChatMessages`; this keeps the scroll position. */
export function ChatView({ friend }: { friend: FriendsFriendUser }) {
  const { t } = useTranslation();
  const currentUserUuid = useFriendsStore((s) => s.currentUser?.uuid);

  const scrollRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const restoreFromBottom = useRef<number | null>(null);
  const stickToBottom = useRef(true);

  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };

  const { messages, chat, loading, loadError, reload, loadingMore, hasMore, olderFailed, loadMore, retryOlder, send } =
    useChatMessages(friend.uuid, {
      // Pin the distance to the bottom, so content above does not move the reader.
      beforeOlder: () => {
        const el = scrollRef.current;
        if (el) restoreFromBottom.current = el.scrollHeight - el.scrollTop;
      },
      beforeNewer: () => {
        stickToBottom.current = isNearBottom();
      },
      afterSend: () => {
        stickToBottom.current = true;
      },
    });

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restoreFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - restoreFromBottom.current;
      restoreFromBottom.current = null;
      return;
    }
    if (stickToBottom.current) scrollToBottom();
  }, [messages, loading, hasMore, loadingMore, olderFailed, scrollToBottom]);

  // Load older messages near the top.
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !hasMore || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { root, rootMargin: "160px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore]);

  const onSend = async (content: string): Promise<boolean> => {
    try {
      await send(content);
      return true;
    } catch (e) {
      toast.error(translateApiError(e, t("chat.send_failed")));
      return false;
    }
  };

  const onRetryLoad = () => {
    stickToBottom.current = true;
    reload();
  };

  const rows = useMemo(() => buildMessageRows(messages, currentUserUuid), [messages, currentUserUuid]);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <ChatHeader friend={friend} />

      <div ref={scrollRef} className="fw-scroll flex min-h-0 flex-1 flex-col">
        {loading ? (
          <MessagesSkeleton />
        ) : loadError ? (
          <div className="m-auto flex max-w-xs flex-col items-center px-6 text-center">
            <span className="fw-icon-tile mb-3">
              <Icon icon="solar:cloud-cross-bold" className="h-6 w-6" />
            </span>
            <p className="fw-name fw-muted">{t("chat.load_failed")}</p>
            <p className="fw-meta fw-faint mt-1 break-words">{loadError}</p>
            <button type="button" className="fw-btn fw-btn-ghost mt-4" onClick={onRetryLoad}>
              {t("common.try_again")}
            </button>
          </div>
        ) : (
          <div className="mt-auto pb-4">
            <div ref={topSentinelRef} className="h-px" />
            {loadingMore && (
              <div className="flex justify-center py-3">
                <Icon icon="svg-spinners:ring-resize" className="fw-faint h-4 w-4" />
              </div>
            )}
            {olderFailed && (
              <div className="flex flex-col items-center gap-2 py-3">
                <p className="fw-meta fw-faint">{t("chat.load_older_failed")}</p>
                <button type="button" className="fw-btn fw-btn-ghost" onClick={retryOlder}>
                  {t("common.try_again")}
                </button>
              </div>
            )}
            {!hasMore && <ConversationStart friend={friend} />}
            {rows.map((row) => (
              <MessageRow
                key={row.message._id}
                message={row.message}
                ts={row.ts}
                newDay={row.newDay}
                first={row.first}
                last={row.last}
                own={row.own}
                friendUuid={friend.uuid}
                friendName={friend.username}
              />
            ))}
          </div>
        )}
      </div>

      <Composer friendName={friend.username} disabled={!chat} onSend={onSend} />
    </section>
  );
}
