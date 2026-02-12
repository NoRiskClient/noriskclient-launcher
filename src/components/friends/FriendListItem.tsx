import { useState, memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { FriendsFriendUser, OnlineState, useFriendsStore } from "../../store/friends-store";
import { useChatStore } from "../../store/chat-store";
import { useThemeStore } from "../../store/useThemeStore";
import { useCrafatarAvatar } from "../../hooks/useCrafatarAvatar";
import { NotificationBadge } from "../ui/NotificationBadge";
import { cn } from "../../lib/utils";

interface FriendListItemProps {
  friend: FriendsFriendUser;
}

const statusColors: Record<OnlineState, string> = {
  ONLINE: "#22c55e",
  AFK: "#f97316",
  BUSY: "#ef4444",
  OFFLINE: "#6b7280",
  INVISIBLE: "#6b7280",
};

export const FriendListItem = memo(function FriendListItem({ friend }: FriendListItemProps) {
  const { t } = useTranslation();
  const { removeFriend, openChat, closeChat, activeChatFriend } = useFriendsStore();
  const { chats } = useChatStore();
  const { accentColor } = useThemeStore();
  const [isRemoving, setIsRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const avatarUrl = useCrafatarAvatar({ uuid: friend.uuid, size: 48 });

  const unreadCount = useMemo(() => {
    const chat = chats.find(c => c.participants.some(p => p.userId === friend.uuid));
    console.log("[FriendListItem]", friend.username, "uuid:", friend.uuid, "found chat:", chat?._id, "unread:", chat?.unreadMessages);
    return chat?.unreadMessages ?? 0;
  }, [chats, friend.uuid]);

  const handleOpenChat = () => {
    if (activeChatFriend?.uuid === friend.uuid) {
      closeChat();
    } else {
      openChat(friend);
    }
  };

  const handleRemoveClick = () => {
    if (isRemoving) return;
    setConfirmRemove(true);
  };

  const handleConfirmRemove = async () => {
    if (isRemoving) return;
    setIsRemoving(true);
    try {
      await removeFriend(friend.username, friend.uuid);
    } catch (e) {
      console.error("Failed to remove friend:", e);
    } finally {
      setIsRemoving(false);
      setConfirmRemove(false);
    }
  };

  const statusConfig: Record<OnlineState, { color: string; label: string }> = {
    ONLINE: { color: statusColors.ONLINE, label: t('friends.status.online') },
    AFK: { color: statusColors.AFK, label: t('friends.status.afk') },
    BUSY: { color: statusColors.BUSY, label: t('friends.status.busy') },
    OFFLINE: { color: statusColors.OFFLINE, label: t('friends.status.offline') },
    INVISIBLE: { color: statusColors.INVISIBLE, label: t('friends.status.offline') },
  };

  const status = statusConfig[friend.state];
  const [isHovered, setIsHovered] = useState(false);

  if (confirmRemove) {
    return (
      <div
        className="flex items-center justify-between p-3 rounded-xl transition-all duration-200"
        style={{
          backgroundColor: "rgba(239, 68, 68, 0.15)",
          border: "1px solid rgba(239, 68, 68, 0.4)",
          minHeight: "72px",
        }}
      >
        <div className="flex items-center gap-2">
          <Icon icon="solar:trash-bin-minimalistic-bold" className="w-5 h-5 text-red-400 flex-shrink-0" />
          <span className="text-sm font-minecraft-ten text-red-400">
            {t('friends.remove_confirm')}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleConfirmRemove}
            disabled={isRemoving}
            className="px-3 py-1.5 rounded-lg text-xs font-minecraft-ten transition-all duration-200 hover:scale-105"
            style={{
              backgroundColor: "rgba(239, 68, 68, 0.3)",
              border: "1px solid rgba(239, 68, 68, 0.5)",
              color: "#ef4444",
            }}
          >
            {isRemoving ? (
              <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin" />
            ) : (
              t('common.confirm')
            )}
          </button>
          <button
            onClick={() => setConfirmRemove(false)}
            className="px-3 py-1.5 rounded-lg text-xs font-minecraft-ten text-white/60 transition-all duration-200 hover:scale-105"
            style={{
              backgroundColor: "rgba(255, 255, 255, 0.1)",
              border: "1px solid rgba(255, 255, 255, 0.2)",
            }}
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl transition-all duration-200 cursor-pointer"
      style={{
        backgroundColor: isHovered ? `${accentColor.value}25` : `${accentColor.value}15`,
        border: `1px solid ${isHovered ? `${accentColor.value}60` : `${accentColor.value}40`}`,
        transform: isHovered ? "translateX(-2px)" : "none",
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleOpenChat}
    >
      <div className="relative flex-shrink-0">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={friend.username}
            className="w-12 h-12 rounded-lg"
            style={{ border: `2px solid ${accentColor.value}50` }}
          />
        ) : (
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${accentColor.value}20`, border: `2px solid ${accentColor.value}50` }}
          >
            <Icon icon="solar:user-bold" className="w-6 h-6" style={{ color: `${accentColor.value}60` }} />
          </div>
        )}
        <div
          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full"
          style={{
            backgroundColor: status.color,
            boxShadow: `0 0 6px ${status.color}80`,
          }}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-base font-medium text-white truncate font-minecraft-ten">
            {friend.username}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-base text-white/50 font-minecraft">
          {friend.server ? (
            <>
              <Icon icon="solar:server-bold" className="w-4 h-4" />
              <span className="truncate">{t('friends.playing_on', { server: friend.server })}</span>
            </>
          ) : (
            <span>{status.label}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleOpenChat();
            }}
            className="p-2 rounded-lg transition-all duration-200 hover:scale-110"
            style={{
              backgroundColor: activeChatFriend?.uuid === friend.uuid ? `${accentColor.value}40` : `${accentColor.value}20`,
              border: `1px solid ${accentColor.value}40`,
              color: accentColor.value,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = `${accentColor.value}40`;
              e.currentTarget.style.borderColor = `${accentColor.value}70`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = activeChatFriend?.uuid === friend.uuid ? `${accentColor.value}40` : `${accentColor.value}20`;
              e.currentTarget.style.borderColor = `${accentColor.value}40`;
            }}
            title={t('friends.chat')}
          >
            <Icon icon="solar:chat-round-dots-bold" className="w-5 h-5" />
          </button>
          <NotificationBadge count={unreadCount} />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleRemoveClick();
          }}
          disabled={isRemoving}
          className="p-2 rounded-lg transition-all duration-200 hover:scale-110"
          style={{
            backgroundColor: `${accentColor.value}20`,
            border: `1px solid ${accentColor.value}40`,
            color: accentColor.value,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = `${accentColor.value}40`;
            e.currentTarget.style.borderColor = `${accentColor.value}70`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = `${accentColor.value}20`;
            e.currentTarget.style.borderColor = `${accentColor.value}40`;
          }}
          title={t('friends.remove_friend')}
        >
          <Icon icon="solar:user-minus-bold" className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
});
