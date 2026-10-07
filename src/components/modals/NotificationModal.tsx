"use client";

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { useNotificationStore, useUnreadCount } from "../../store/notification-store";
import { getNotificationMessage, getNotificationNote, UserNotification } from "../../types/notification";
import { timeAgo } from "../../utils/time-utils";
import { useId, useRef } from "react";
import { useAnimationsEnabled } from "../../hooks/useEntranceAnimation";

export function NotificationModal() {
  const { t } = useTranslation();
  const { notifications, isModalOpen, closeModal, markAllAsRead, isLoading, error,
    fetchNotifications, isMarkingRead, markReadError, retryMarkRead } = useNotificationStore();
  const unreadCount = useUnreadCount();
  const animationsEnabled = useAnimationsEnabled();
  const contentRef = useRef<HTMLDivElement>(null);
  const markAllActionRef = useRef<HTMLButtonElement>(null);
  const readRetryActionRef = useRef<HTMLButtonElement>(null);
  const ackRetryActionRef = useRef<HTMLButtonElement>(null);

  if (!isModalOpen) return null;

  const focusOwnedDialog = (action: HTMLButtonElement | null) => {
    if (action && document.activeElement === action) {
      contentRef.current?.closest<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true });
    }
  };

  const handleMarkAllRead = async () => {
    focusOwnedDialog(markAllActionRef.current);
    try { await markAllAsRead(); } catch { /* The store keeps the truthful, recoverable acknowledgement error. */ }
  };

  const handleRetryRead = async () => {
    focusOwnedDialog(readRetryActionRef.current);
    try { await fetchNotifications(); } catch { /* The store keeps the read error and direct retry available. */ }
  };

  const handleRetryMarkRead = async () => {
    focusOwnedDialog(ackRetryActionRef.current);
    try { await retryMarkRead(); } catch { /* The previous unread flags and retry target remain available. */ }
  };

  return (
    <Modal
      title={t('notification_modal.title')}
      titleIcon={<Icon icon="solar:bell-bold" className="w-6 h-6" />}
      onClose={closeModal}
      width="md"
      headerActions={
        unreadCount > 0 ? (
          <Button
            ref={markAllActionRef}
            variant="ghost"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={isMarkingRead || isLoading}
            aria-busy={isMarkingRead || undefined}
            icon={<Icon icon="mdi:check-all" />}
          >
            {isMarkingRead ? t('common.saving') : t('notification_modal.mark_all_read')}
          </Button>
        ) : undefined
      }
    >
      <div ref={contentRef} className="p-4 space-y-2 min-h-[200px] max-h-[60vh] overflow-y-auto custom-scrollbar">
        {error && (
          <div className="rounded-md border border-red-400/30 bg-red-950/20 p-3">
            <p role="alert" className="font-minecraft text-sm text-red-300 break-words">{t('notification_modal.load_failed')}</p>
            {notifications.length > 0 && <p className="mt-2 font-minecraft text-xs text-white/70">{t('notification_modal.previous_notifications')}</p>}
            <Button ref={readRetryActionRef} onClick={handleRetryRead} variant="flat-secondary" size="sm" disabled={isLoading} className="mt-3">{t('common.try_again')}</Button>
          </div>
        )}
        {markReadError && (
          <div className="rounded-md border border-red-400/30 bg-red-950/20 p-3">
            <p role="alert" className="font-minecraft text-sm text-red-300 break-words">
              {t(markReadError.notificationId === null ? 'notification_modal.mark_all_read_failed' : 'notification_modal.mark_read_failed')}
            </p>
            <Button ref={ackRetryActionRef} onClick={handleRetryMarkRead} variant="flat-secondary" size="sm" disabled={isMarkingRead || isLoading}
              aria-busy={isMarkingRead || undefined} className="mt-3">{t('common.try_again')}</Button>
          </div>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center gap-3 py-8" role="status">
            <Icon icon="mdi:loading" className={`w-8 h-8 text-white/50${animationsEnabled ? " animate-spin" : ""}`} aria-hidden="true" />
            <span className="font-minecraft text-sm text-white/70">{t('common.loading')}</span>
          </div>
        ) : notifications.length === 0 ? (
          !error && <div className="flex flex-col items-center justify-center py-8 text-white/50">
            <Icon icon="solar:bell-off-outline" className="w-12 h-12 mb-2" />
            <p className="font-minecraft text-sm">{t('notification_modal.no_notifications')}</p>
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
  const { t } = useTranslation();
  const animationsEnabled = useAnimationsEnabled();
  const { isMarkingRead, markingNotificationId } = useNotificationStore();
  const messageId = useId();
  const rowRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const message = getNotificationMessage(notification.notification);
  const note = getNotificationNote(notification.notification);
  const createdAt = notification.notification.createdAt;
  const relativeTime = createdAt ? timeAgo(new Date(createdAt).getTime()) : "";

  const handleMarkSingleRead = async () => {
    // Keep keyboard focus on this stable row before the successful action can
    // disappear, or become disabled while pending. Do not steal unrelated focus.
    if (actionRef.current && document.activeElement === actionRef.current) rowRef.current?.focus({ preventScroll: true });
    try { await useNotificationStore.getState().markAsRead(notification._id); } catch { /* Reported by the modal/store error state. */ }
  };

  return (
    <div
      ref={rowRef}
      tabIndex={-1}
      role="group"
      aria-labelledby={messageId}
      className={`p-3 rounded-lg transition-colors flex gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 ${
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
      <div className="min-w-0 flex-1 break-words">
        <p id={messageId} className={`text-sm font-sans ${notification.seen ? "text-white/60" : "text-white"}`}>
          {message}
        </p>
        {note && (
          <p className="text-xs font-sans italic text-white/60 mt-1 break-words">"{note}"</p>
        )}
        <p className="text-xs font-sans text-white/40 mt-1">{relativeTime}</p>
      </div>
      {/* Buttons/Icons */}
      <div className="flex w-8 flex-col items-center shrink-0">
        {!notification.seen && (
          <button ref={actionRef} type="button" onClick={handleMarkSingleRead} disabled={isMarkingRead}
            aria-label={t('notification_modal.mark_read')} aria-describedby={messageId}
            title={t('notification_modal.mark_read')} aria-busy={isMarkingRead && markingNotificationId === notification._id || undefined}
            className="min-w-8 min-h-8 inline-flex items-center justify-center rounded-md text-accent hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 disabled:opacity-50 disabled:cursor-wait">
            <Icon icon={isMarkingRead && markingNotificationId === notification._id ? "mdi:loading" : "mdi:check"}
              className={animationsEnabled && isMarkingRead && markingNotificationId === notification._id ? "w-4 h-4 animate-spin" : "w-4 h-4"} aria-hidden="true" />
          </button>
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
