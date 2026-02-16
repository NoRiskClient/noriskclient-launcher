"use client";

import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useNotificationStore, useUnreadCount } from "../../store/notification-store";
import { NotificationBadge } from "../ui/NotificationBadge";

export function NotificationBell() {
  const { t } = useTranslation();
  const { openModal } = useNotificationStore();
  const unreadCount = useUnreadCount();

  return (
    <button
      onClick={openModal}
      className="relative p-2 text-white/70 hover:text-white transition-colors cursor-pointer"
      aria-label={t('header.notifications')}
    >
      <Icon icon="solar:bell-bold" className="w-5 h-5" />
      <NotificationBadge count={unreadCount} />
    </button>
  );
}
