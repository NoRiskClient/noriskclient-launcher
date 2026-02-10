import { create } from "zustand";
import type { UserNotification } from "../types/notification";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "../services/nrc-service";

interface NotificationStoreState {
  notifications: UserNotification[];
  isModalOpen: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  setNotifications: (notifications: UserNotification[]) => void;
  fetchNotifications: () => Promise<void>;
  markAllAsRead: () => Promise<void>;
    markAsRead: (notificationId: string) => Promise<void>;
  openModal: () => void;
  closeModal: () => void;
}

export const useNotificationStore = create<NotificationStoreState>((set, get) => ({
  notifications: [],
  isModalOpen: false,
  isLoading: false,
  error: null,

  setNotifications: (notifications) => set({ notifications }),

  fetchNotifications: async () => {
    set({ isLoading: true, error: null });
    try {
      const notifications = await getNotifications();
      // Sort by createdAt descending (newest first)
      const sorted = notifications.sort((a, b) => {
        const dateA = a.notification.createdAt ? new Date(a.notification.createdAt).getTime() : 0;
        const dateB = b.notification.createdAt ? new Date(b.notification.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      set({ notifications: sorted, isLoading: false });
    } catch (error) {
      console.error("[NotificationStore] Failed to fetch notifications:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to fetch notifications",
        isLoading: false,
      });
    }
  },

  markAllAsRead: async () => {
    try {
      await markAllNotificationsRead();
      // Update local state to mark all as seen
      set((state) => ({
        notifications: state.notifications.map((n) => ({ ...n, seen: true })),
      }));
    } catch (error) {
      console.error("[NotificationStore] Failed to mark notifications as read:", error);
    }
  },

  markAsRead: async (notificationId: string) => {
    try {
      await markNotificationRead(notificationId);
      // Update local state to mark the specific notification as seen
      set((state) => ({
        notifications: state.notifications.map((n) =>
          n._id === notificationId ? { ...n, seen: true } : n
        ),
      }));
    } catch (error) {
      console.error(`[NotificationStore] Failed to mark notification ${notificationId} as read:`, error);
    }
  },

  openModal: () => set({ isModalOpen: true }),
  closeModal: () => set({ isModalOpen: false }),
}));

// Selector for unread count
export const useUnreadCount = () =>
  useNotificationStore((state) => state.notifications.filter((n) => !n.seen).length);
