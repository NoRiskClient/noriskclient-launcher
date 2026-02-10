"use client";

import { Icon } from "@iconify/react";
import { useNotificationStore, useUnreadCount } from "../../store/notification-store";
import { NotificationBadge } from "../ui/NotificationBadge";

export function NotificationBell() {
  const { openModal } = useNotificationStore();
  const unreadCount = useUnreadCount();

  return (
    <button
      onClick={openModal}
      className="relative p-2 text-white/70 hover:text-white transition-colors cursor-pointer"
      aria-label="Notifications"
    >
      <Icon icon="solar:bell-bold" className="w-5 h-5" />
      <NotificationBadge count={unreadCount} />
    </button>
  );
}
