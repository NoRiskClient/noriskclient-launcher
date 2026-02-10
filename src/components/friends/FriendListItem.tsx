import { useState, memo, useMemo } from "react";
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

const statusConfig: Record<OnlineState, { color: string; label: string }> = {
  ONLINE: { color: "#22c55e", label: "ONLINE" },
  AFK: { color: "#f97316", label: "AFK" },
  BUSY: { color: "#ef4444", label: "BUSY" },
  OFFLINE: { color: "#6b7280", label: "OFFLINE" },
  INVISIBLE: { color: "#6b7280", label: "OFFLINE" },
};

export const FriendListItem = memo(function FriendListItem({ friend }: FriendListItemProps) {
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

  const handleRemoveClick = async () => {
    if (isRemoving) return;

    if (!confirmRemove) {
      setConfirmRemove(true);
      setTimeout(() => setConfirmRemove(false), 3000);
      return;
    }

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

  const status = statusConfig[friend.state];
  const [isHovered, setIsHovered] = useState(false);

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
              <span className="truncate">playing on {friend.server}</span>
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
            title="Chat"
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
            backgroundColor: confirmRemove ? "rgba(239, 68, 68, 0.25)" : `${accentColor.value}20`,
            border: `1px solid ${confirmRemove ? "rgba(239, 68, 68, 0.5)" : `${accentColor.value}40`}`,
            color: confirmRemove ? "#ef4444" : accentColor.value,
          }}
          onMouseEnter={(e) => {
            if (!confirmRemove) {
              e.currentTarget.style.backgroundColor = `${accentColor.value}40`;
              e.currentTarget.style.borderColor = `${accentColor.value}70`;
            }
          }}
          onMouseLeave={(e) => {
            if (!confirmRemove) {
              e.currentTarget.style.backgroundColor = `${accentColor.value}20`;
              e.currentTarget.style.borderColor = `${accentColor.value}40`;
            }
          }}
          title={confirmRemove ? "Click again to remove" : "Remove Friend"}
        >
          <Icon
            icon={confirmRemove ? "solar:trash-bin-minimalistic-bold" : "solar:user-minus-bold"}
            className={cn("w-5 h-5", isRemoving && "animate-pulse")}
          />
        </button>
      </div>
    </div>
  );
});
