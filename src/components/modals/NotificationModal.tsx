"use client";

import { Icon } from "@iconify/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { useNotificationStore, useUnreadCount } from "../../store/notification-store";
import { getNotificationMessage, UserNotification } from "../../types/notification";
import { timeAgo } from "../../utils/time-utils";

export function NotificationModal() {
  const { notifications, isModalOpen, closeModal, markAllAsRead, isLoading } = useNotificationStore();
  const unreadCount = useUnreadCount();

  if (!isModalOpen) return null;

  const handleMarkAllRead = async () => {
    await markAllAsRead();
  };

  return (
    <Modal
      title="Notifications"
      titleIcon={<Icon icon="solar:bell-bold" className="w-6 h-6" />}
      onClose={closeModal}
      width="md"
      headerActions={
        unreadCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMarkAllRead}
            icon={<Icon icon="mdi:check-all" />}
          >
            Mark all read
          </Button>
        ) : undefined
      }
    >
      <div className="p-4 space-y-2 min-h-[200px] max-h-[60vh] overflow-y-auto custom-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Icon icon="mdi:loading" className="w-8 h-8 animate-spin text-white/50" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-white/50">
            <Icon icon="solar:bell-off-outline" className="w-12 h-12 mb-2" />
            <p className="font-minecraft-ten text-sm">No notifications</p>
          </div>
        ) : (
          notifications.map((notification) => (
            <NotificationItem key={notification._id} notification={notification} />
          ))
        )}
      </div>
    </Modal>
  );
}

function NotificationItem({ notification }: Readonly<{ notification: UserNotification }>) {
  const message = getNotificationMessage(notification.notification);
  const createdAt = notification.notification.createdAt;
  const relativeTime = createdAt ? timeAgo(new Date(createdAt).getTime()) : "";

  const handleMarkSingleRead = async (e: any) => {
    await useNotificationStore.getState().markAsRead(e);
  }

  return (
    <div
      className={`p-3 rounded-lg transition-colors flex ${
        notification.seen
          ? "bg-black/20 border-l-4"
          : "bg-black/30 border-l-4 border-accent"
      }`}
      style={{
        borderLeftColor: notification.seen ? "transparent" : "var(--accent-color)", // Transparent so spacing is maintained
        justifyContent: "space-between",
        alignItems: "flex-start",
      }}
    >
      <div>
        <p className={`text-sm font-sans ${notification.seen ? "text-white/60" : "text-white"}`}>
          {message}
        </p>
        <p className="text-xs font-sans text-white/40 mt-1">{relativeTime}</p>
      </div>
      {/* Buttons/Icons */}
      <div style={{display: "flex", justifyContent: "space-between", flexDirection: "column", alignItems: "center"}}>
        {!notification.seen && (
            <Icon
                icon="mdi:close"
                className="bold w-3 h-3 mt-1 text-accent"
                style={{ cursor: "pointer" }}
                onClick={() => handleMarkSingleRead(notification._id)}
            />
        )}
        {false && (
            <Icon
              icon="mdi:chevron-right"
              className="w-4 h-4 mt-1 text-white/40"
            />
        )}
      </div>
    </div>
  );
}
