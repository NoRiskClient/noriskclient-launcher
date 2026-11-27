import { forwardRef, memo, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useFriendsStore, type FriendsFriendUser } from "../../../store/friends-store";
import { messageTime, useChatStore, type ComputedChat } from "../../../store/chat-store";
import { PlayerAvatar } from "./PlayerAvatar";
import { CountBadge } from "./CountBadge";
import { Popover } from "./Popover";
import { AddFriendForm } from "./AddFriendForm";
import { SelfBar } from "./SelfBar";
import { isOnlineState, statusMeta } from "./status";
import { formatListStamp } from "./time";
import { buildPeopleSections, type SectionKey } from "./people-sections";

interface FriendsListPaneProps {
  incomingCount: number;
}

export const FriendsListPane = forwardRef<HTMLInputElement, FriendsListPaneProps>(function FriendsListPane(
  { incomingCount },
  searchRef,
) {
  const { t } = useTranslation();
  const activeView = useFriendsStore((s) => s.activeView);
  const openView = useFriendsStore((s) => s.openView);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);

  return (
    <aside className="fw-pane fw-line-r flex w-[300px] shrink-0 flex-col">
      <div className="p-3">
        <div className="flex items-center gap-1.5">
          <label className="fw-field min-w-0 flex-1">
            <Icon icon="solar:magnifer-linear" className="fw-faint h-3.5 w-3.5 shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.stopPropagation();
                  setQuery("");
                }
              }}
              placeholder={t("friends.search_placeholder")}
              spellCheck={false}
              autoComplete="off"
            />
            {query && (
              <button
                type="button"
                className="fw-faint hover:text-white"
                onClick={() => setQuery("")}
                aria-label={t("common.clear_search")}
              >
                <Icon icon="solar:close-circle-bold" className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
          <button
            type="button"
            className="fw-icon-btn"
            data-active={activeView === "requests"}
            onClick={() => openView("requests")}
            title={t("friends.requests_title")}
            aria-label={t("friends.requests_title")}
          >
            <Icon icon="solar:inbox-bold" className="h-4 w-4" />
            <CountBadge count={incomingCount} max={9} corner />
          </button>
          <button
            ref={addRef}
            type="button"
            className="fw-icon-btn"
            data-active={addOpen}
            onClick={() => setAddOpen((v) => !v)}
            title={t("friends.add_friend")}
            aria-label={t("friends.add_friend")}
          >
            <Icon icon="solar:user-plus-bold" className="h-4 w-4" />
          </button>
          <Popover open={addOpen} onClose={() => setAddOpen(false)} anchorRef={addRef} width={300} align="end">
            <div className="p-2">
              <div className="fw-label mb-2">{t("friends.add_friend")}</div>
              <AddFriendForm autoFocus />
            </div>
          </Popover>
        </div>
      </div>

      <div className="fw-scroll min-h-0 flex-1 px-2 pb-2">
        <PeopleList query={query} />
      </div>

      <SelfBar />
    </aside>
  );
});

const SECTION_META: Record<SectionKey, { labelKey: string; icon: string }> = {
  recent: { labelKey: "friends.section_recent", icon: "solar:chat-line-bold" },
  friends: { labelKey: "friends.section_friends", icon: "solar:users-group-rounded-bold" },
};

function PeopleList({ query }: { query: string }) {
  const { t } = useTranslation();
  const friends = useFriendsStore((s) => s.friends);
  const isLoading = useFriendsStore((s) => s.isLoading);
  const currentUserUuid = useFriendsStore((s) => s.currentUser?.uuid);
  const chats = useChatStore((s) => s.chats);
  const readUpTo = useChatStore((s) => s.readUpTo);
  const [collapsed, setCollapsed] = useState<Partial<Record<SectionKey, boolean>>>({});

  const sections = useMemo(
    () => buildPeopleSections({ friends, chats, readUpTo, me: currentUserUuid, query }),
    [friends, chats, readUpTo, currentUserUuid, query],
  );

  if (isLoading) return <ListSkeleton />;

  if (friends.length === 0) {
    return (
      <ListEmpty
        icon="solar:users-group-rounded-bold"
        title={t("friends.no_friends_title")}
        body={t("friends.no_friends_hint")}
      />
    );
  }

  if (sections.every((s) => s.rows.length === 0)) {
    return <ListEmpty icon="solar:magnifer-bold" title={t("friends.no_search_results", { query: query.trim() })} />;
  }

  return (
    <>
      {sections.map((section) =>
        section.rows.length === 0 ? null : (
          <section key={section.key}>
            <button
              type="button"
              className="fw-group-toggle"
              onClick={() => setCollapsed((c) => ({ ...c, [section.key]: !c[section.key] }))}
              aria-expanded={!collapsed[section.key]}
            >
              <Icon
                icon="solar:alt-arrow-down-linear"
                className="fw-faint h-3 w-3 transition-transform"
                style={{ transform: collapsed[section.key] ? "rotate(-90deg)" : undefined }}
              />
              <Icon icon={SECTION_META[section.key].icon} className="fw-faint h-3 w-3" />
              <span className="fw-label">{t(SECTION_META[section.key].labelKey)}</span>
              <span className="fw-label fw-num">{section.rows.length}</span>
              {section.key === "friends" && section.online > 0 && (
                <span className="fw-label fw-num ml-auto flex items-center gap-1.5">
                  <span className="fw-dot" style={{ backgroundColor: "var(--fw-online)" }} />
                  {t("friends.online_count", { count: section.online })}
                </span>
              )}
            </button>
            {!collapsed[section.key] && (
              <div className="space-y-px">
                {section.rows.map(({ friend, chat, unread }) =>
                  section.key === "recent" && chat ? (
                    <ChatRow key={friend.uuid} chat={chat} friend={friend} unread={unread} />
                  ) : (
                    <FriendRow key={friend.uuid} friend={friend} unread={unread} />
                  ),
                )}
              </div>
            )}
          </section>
        ),
      )}
    </>
  );
}

const FriendRow = memo(function FriendRow({ friend, unread }: { friend: FriendsFriendUser; unread: number }) {
  const { t } = useTranslation();
  const isActive = useFriendsStore((s) => s.activeView === "chat" && s.activeChatFriend?.uuid === friend.uuid);
  const openChat = useFriendsStore((s) => s.openChat);
  const online = isOnlineState(friend.state);

  return (
    <button type="button" className="fw-row" data-active={isActive} onClick={() => openChat(friend)}>
      <PlayerAvatar uuid={friend.uuid} name={friend.username} size={32} status={friend.state} dim={!online} />
      <span className="min-w-0 flex-1">
        <span className={`fw-name block truncate ${online ? "fw-ink" : "fw-muted"}`}>{friend.username}</span>
        <span className="fw-meta fw-faint block truncate">
          {online && friend.server
            ? t("friends.playing_on", { server: friend.server })
            : t(statusMeta(friend.state).labelKey)}
        </span>
      </span>
      <CountBadge count={unread} />
    </button>
  );
});

const ChatRow = memo(function ChatRow({
  chat,
  friend,
  unread,
}: {
  chat: ComputedChat;
  friend: FriendsFriendUser;
  unread: number;
}) {
  const { t } = useTranslation();
  const isActive = useFriendsStore((s) => s.activeView === "chat" && s.activeChatFriend?.uuid === friend.uuid);
  const openChat = useFriendsStore((s) => s.openChat);
  const currentUserUuid = useFriendsStore((s) => s.currentUser?.uuid);
  const latest = chat.latestMessage;
  const own = !!latest && latest.senderId.toLowerCase() === currentUserUuid?.toLowerCase();

  return (
    <button type="button" className="fw-row" data-active={isActive} onClick={() => openChat(friend)}>
      <PlayerAvatar uuid={friend.uuid} name={friend.username} size={32} status={friend.state} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`fw-name min-w-0 flex-1 truncate ${unread > 0 ? "fw-ink" : "fw-muted"}`}>{friend.username}</span>
          <span className="fw-meta fw-faint fw-num shrink-0">{formatListStamp(messageTime(latest), t)}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className={`fw-meta block min-w-0 flex-1 truncate ${unread > 0 ? "fw-muted" : "fw-faint"}`}>
            {own && <span className="fw-faint">{t("chat.you_prefix")} </span>}
            {latest?.deletedAt ? <span className="italic">{t("chat.message_deleted")}</span> : latest?.content}
          </span>
          <CountBadge count={unread} />
        </span>
      </span>
    </button>
  );
});

function ListSkeleton() {
  return (
    <div className="space-y-1 pt-3">
      {[70, 52, 84, 60, 46].map((w, i) => (
        <div key={i} className="flex items-center gap-2.5 px-2 py-2">
          <span className="fw-skeleton h-8 w-8" />
          <span className="flex-1 space-y-1.5">
            <span className="fw-skeleton block h-2.5" style={{ width: `${w}%` }} />
            <span className="fw-skeleton block h-2 w-1/3" />
          </span>
        </div>
      ))}
    </div>
  );
}

function ListEmpty({ icon, title, body }: { icon: string; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center px-6 pt-12 text-center">
      <span className="fw-icon-tile mb-3">
        <Icon icon={icon} className="h-6 w-6" />
      </span>
      <p className="fw-name fw-muted">{title}</p>
      {body && <p className="fw-meta fw-faint mt-1">{body}</p>}
    </div>
  );
}
