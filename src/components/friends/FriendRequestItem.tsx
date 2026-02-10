import { useState, memo } from "react";
import { Icon } from "@iconify/react";
import { FriendRequestWithUsers, useFriendsStore } from "../../store/friends-store";
import { useThemeStore } from "../../store/useThemeStore";
import { useCrafatarAvatar } from "../../hooks/useCrafatarAvatar";
import { cn } from "../../lib/utils";

interface FriendRequestItemProps {
  request: FriendRequestWithUsers;
  type: "incoming" | "outgoing";
}

export const FriendRequestItem = memo(function FriendRequestItem({ request, type }: FriendRequestItemProps) {
  const { acceptRequest, denyRequest, currentUser } = useFriendsStore();
  const { accentColor } = useThemeStore();
  const [isLoading, setIsLoading] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const otherUser = request.users.find((u) => u.uuid !== currentUser?.uuid);
  const avatarUrl = useCrafatarAvatar({ uuid: otherUser?.uuid, size: 48 });

  if (!otherUser) return null;

  const handleAccept = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      await acceptRequest(otherUser.username);
    } catch (e) {
      console.error("Failed to accept request:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeny = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      await denyRequest(otherUser.username);
    } catch (e) {
      console.error("Failed to deny request:", e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl transition-all duration-200"
      style={{
        backgroundColor: isHovered ? `${accentColor.value}25` : `${accentColor.value}15`,
        border: `1px solid ${isHovered ? `${accentColor.value}60` : `${accentColor.value}40`}`,
        transform: isHovered ? "translateX(-2px)" : "none",
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex-shrink-0">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={otherUser.username}
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
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-base font-medium text-white truncate font-minecraft-ten">
            {otherUser.username}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-base text-white/50 font-minecraft">
          <Icon
            icon={type === "incoming" ? "solar:inbox-in-bold" : "solar:inbox-out-bold"}
            className="w-4 h-4"
          />
          <span>{type === "incoming" ? "wants to be friends" : "pending..."}</span>
        </div>
      </div>

      {type === "incoming" ? (
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleAccept}
            disabled={isLoading}
            className={cn(
              "p-2 rounded-lg transition-all duration-200 hover:scale-110",
              isLoading && "opacity-50 cursor-not-allowed"
            )}
            style={{
              backgroundColor: "rgba(34, 197, 94, 0.2)",
              border: "1px solid rgba(34, 197, 94, 0.4)",
              color: "#22c55e",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(34, 197, 94, 0.35)";
              e.currentTarget.style.borderColor = "rgba(34, 197, 94, 0.6)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(34, 197, 94, 0.2)";
              e.currentTarget.style.borderColor = "rgba(34, 197, 94, 0.4)";
            }}
            title="Accept"
          >
            <Icon icon="solar:check-circle-bold" className="w-5 h-5" />
          </button>
          <button
            onClick={handleDeny}
            disabled={isLoading}
            className={cn(
              "p-2 rounded-lg transition-all duration-200 hover:scale-110",
              isLoading && "opacity-50 cursor-not-allowed"
            )}
            style={{
              backgroundColor: "rgba(239, 68, 68, 0.2)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              color: "#ef4444",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.35)";
              e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.6)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.2)";
              e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.4)";
            }}
            title="Deny"
          >
            <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
          </button>
        </div>
      ) : (
        <button
          onClick={handleDeny}
          disabled={isLoading}
          className={cn(
            "p-2 rounded-lg transition-all duration-200 hover:scale-110",
            isLoading && "opacity-50 cursor-not-allowed"
          )}
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
          title="Cancel Request"
        >
          <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
        </button>
      )}
    </div>
  );
});
