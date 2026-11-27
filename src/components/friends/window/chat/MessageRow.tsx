import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { FriendsFriendUser } from "../../../../store/friends-store";
import type { ChatMessage } from "../../../../store/chat-store";
import { PlayerAvatar } from "../PlayerAvatar";
import { formatClock, formatDayLabel } from "../time";

export function ConversationStart({ friend }: { friend: FriendsFriendUser }) {
  const { t } = useTranslation();
  return (
    <p className="fw-meta fw-faint px-5 pb-1 pt-6 text-center">
      {t("chat.conversation_start", { name: friend.username })}
    </p>
  );
}

interface MessageRowProps {
  message: ChatMessage;
  ts: number;
  newDay: boolean;
  /** First and last message of a group from one sender. */
  first: boolean;
  last: boolean;
  own: boolean;
  friendUuid: string;
  friendName: string;
}

/** A chat bubble. No names with only two people; head and time show once per group. */
export const MessageRow = memo(function MessageRow({
  message,
  ts,
  newDay,
  first,
  last,
  own,
  friendUuid,
  friendName,
}: MessageRowProps) {
  const { t } = useTranslation();
  const clock = formatClock(ts);
  const deleted = !!message.deletedAt;

  return (
    <>
      {newDay && ts > 0 && (
        <div className="fw-divider" role="separator">
          <span className="fw-label">{formatDayLabel(ts, t)}</span>
        </div>
      )}
      <div className={first ? "fw-bubble-row fw-bubble-row-first" : "fw-bubble-row"} data-own={own}>
        {!own && (
          <span className="fw-bubble-avatar" aria-hidden={!last}>
            {last && <PlayerAvatar uuid={friendUuid} name={friendName} size={28} />}
          </span>
        )}
        <div
          className="fw-bubble"
          data-own={own}
          data-first={first}
          data-last={last}
          data-deleted={deleted}
          title={clock}
        >
          {deleted ? (
            <span className="italic">{t("chat.message_deleted")}</span>
          ) : (
            <>
              {message.content}
              {message.editedAt && <span className="fw-bubble-edited">{t("chat.edited")}</span>}
            </>
          )}
        </div>
      </div>
      {last && clock && (
        <p className="fw-bubble-time fw-meta fw-faint fw-num" data-own={own}>
          {clock}
        </p>
      )}
    </>
  );
});

export function MessagesSkeleton() {
  const bubbles: { own: boolean; w: number }[] = [
    { own: false, w: 46 },
    { own: false, w: 30 },
    { own: true, w: 38 },
    { own: false, w: 55 },
    { own: true, w: 26 },
  ];
  return (
    <div className="mt-auto space-y-2 pb-6">
      {bubbles.map((b, i) => (
        <div key={i} className="fw-bubble-row" data-own={b.own}>
          {!b.own && <span className="fw-bubble-avatar" />}
          <span className="fw-skeleton block h-9" style={{ width: `${b.w}%` }} />
        </div>
      ))}
    </div>
  );
}
