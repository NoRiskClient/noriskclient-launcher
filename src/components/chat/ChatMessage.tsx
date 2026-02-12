import { Icon } from "@iconify/react";
import { useCrafatarAvatar } from "../../hooks/useCrafatarAvatar";

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

interface ChatMessageProps {
  message: Message;
  isOwn: boolean;
  friendUuid: string;
  friendName: string;
  currentUserUuid?: string;
  currentUserName?: string;
  accentColor: string;
  showHeader: boolean;
}

export function ChatMessage({ message, isOwn, friendUuid, friendName, currentUserUuid, currentUserName, accentColor, showHeader }: ChatMessageProps) {
  const avatarUuid = isOwn ? currentUserUuid : friendUuid;
  const avatarUrl = useCrafatarAvatar({ uuid: avatarUuid, size: 32 });

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const timestamp = message.createdAt || message.sentAt || message.timestamp;
  const displayName = isOwn ? (currentUserName || "You") : friendName;

  return (
    <div className="flex gap-3 px-3 py-1 hover:bg-white/5 transition-colors group">
      {/* Avatar or hover timestamp */}
      <div className="w-8 flex-shrink-0 flex items-start justify-center pt-0.5">
        {showHeader ? (
          avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              className="w-8 h-8 rounded-md"
            />
          ) : (
            <div
              className="w-8 h-8 rounded-md flex items-center justify-center"
              style={{ backgroundColor: `${accentColor}20` }}
            >
              <Icon icon="solar:user-bold" className="w-4 h-4" style={{ color: accentColor }} />
            </div>
          )
        ) : (
          <span className="text-[10px] text-white/30 opacity-0 group-hover:opacity-100 transition-opacity font-minecraft-ten">
            {formatTime(timestamp)}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {showHeader && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span
              className="font-minecraft-ten text-sm"
              style={{ color: isOwn ? accentColor : "#ffffff" }}
            >
              {displayName}
            </span>
            <span className="text-[11px] text-white/40 font-minecraft-ten">
              {formatTime(timestamp)}
            </span>
          </div>
        )}
        <p className="text-sm text-white/90 whitespace-pre-wrap break-words font-minecraft-ten leading-relaxed">
          {message.content}
        </p>
      </div>
    </div>
  );
}
