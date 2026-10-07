import { create } from "zustand";
import type { UserNotification } from "../types/notification";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "../services/nrc-service";
import { useMinecraftAuthStore } from "./minecraft-auth-store";

type MarkReadError = { notificationId: string | null };

interface NotificationStoreState {
  notifications: UserNotification[];
  isModalOpen: boolean;
  isLoading: boolean;
  error: string | null;
  isMarkingRead: boolean;
  markingNotificationId: string | null;
  markReadError: MarkReadError | null;

  // Actions
  setNotifications: (notifications: UserNotification[]) => void;
  fetchNotifications: () => Promise<void>;
  markAllAsRead: () => Promise<boolean>;
  markAsRead: (notificationId: string) => Promise<boolean>;
  retryMarkRead: () => Promise<boolean>;
  openModal: () => void;
  closeModal: () => void;
}

export const useNotificationStore = create<NotificationStoreState>((set, get) => {
  const accountId = () => useMinecraftAuthStore.getState().activeAccount?.id ?? null;
  let dataAccountId: string | null | undefined;
  let accountGeneration = 0;
  let readGeneration = 0;
  let activeRead: { accountId: string | null; generation: number; promise: Promise<void> } | null = null;
  let markingRead = false;

  const acknowledge = async (notificationId: string | null): Promise<boolean> => {
    // A stale pre-render callback must not issue a second acknowledgement.
    if (markingRead) return false;
    const currentAccountId = accountId();
    if (dataAccountId !== currentAccountId) return false;
    const generation = accountGeneration;
    const ids = new Set(get().notifications.filter((row) => !row.seen &&
      (notificationId === null || row._id === notificationId)).map((row) => row._id));
    if (ids.size === 0) return false;
    markingRead = true;
    set({ isMarkingRead: true, markingNotificationId: notificationId, markReadError: null });
    const isCurrent = () => generation === accountGeneration && currentAccountId === accountId() && dataAccountId === currentAccountId;
    try {
      if (notificationId === null) await markAllNotificationsRead();
      else await markNotificationRead(notificationId);
      if (!isCurrent()) return false;
      // A GET begun before this confirmed acknowledgement may still contain old
      // unread flags. Ignore that stale reply rather than undoing the success.
      readGeneration += 1;
      set((state) => ({
        isLoading: false,
        notifications: state.notifications.map((row) => ids.has(row._id) ? { ...row, seen: true } : row),
      }));
      return true;
    } catch (error) {
      if (isCurrent()) set({ markReadError: { notificationId } });
      console.error("[NotificationStore] Failed to mark notifications as read:", error);
      throw error;
    } finally {
      markingRead = false;
      set({ isMarkingRead: false, markingNotificationId: null });
    }
  };

  return {
    notifications: [],
    isModalOpen: false,
    isLoading: false,
    error: null,
    isMarkingRead: false,
    markingNotificationId: null,
    markReadError: null,

    setNotifications: (notifications) => {
      const currentAccountId = accountId();
      const markError = dataAccountId === currentAccountId ? get().markReadError : null;
      const unresolvedMarkError = markError && notifications.some((row) => !row.seen &&
        (markError.notificationId === null || row._id === markError.notificationId));
      dataAccountId = currentAccountId;
      accountGeneration += 1;
      readGeneration += 1;
      set({ notifications, isLoading: false, error: null, markReadError: unresolvedMarkError ? markError : null });
    },

    fetchNotifications: () => {
      const currentAccountId = accountId();
      if (activeRead?.accountId === currentAccountId && activeRead.generation === readGeneration) return activeRead.promise;
      const generation = ++readGeneration;
      if (dataAccountId !== currentAccountId) {
        dataAccountId = currentAccountId;
        accountGeneration += 1;
        set({ notifications: [], markReadError: null });
      }
      set({ isLoading: true, error: null });
      const isCurrent = () => generation === readGeneration && accountId() === currentAccountId;
      const promise = (async () => {
        try {
          const notifications = await getNotifications();
          if (!isCurrent()) return;
          // Sort by createdAt descending (newest first), without mutating the reply.
          const sorted = [...notifications].sort((a, b) => {
            const dateA = a.notification.createdAt ? new Date(a.notification.createdAt).getTime() : 0;
            const dateB = b.notification.createdAt ? new Date(b.notification.createdAt).getTime() : 0;
            return dateB - dateA;
          });
          const markError = get().markReadError;
          const unresolvedMarkError = markError && sorted.some((row) => !row.seen &&
            (markError.notificationId === null || row._id === markError.notificationId));
          set({ notifications: sorted, markReadError: unresolvedMarkError ? markError : null });
        } catch (error) {
          if (!isCurrent()) return;
          console.error("[NotificationStore] Failed to fetch notifications:", error);
          set({ error: error instanceof Error ? error.message : "Failed to fetch notifications" });
        } finally {
          if (isCurrent()) set({ isLoading: false });
          if (activeRead?.generation === generation) activeRead = null;
        }
      })();
      activeRead = { accountId: currentAccountId, generation, promise };
      return promise;
    },

    markAllAsRead: () => acknowledge(null),
    markAsRead: (notificationId) => acknowledge(notificationId),
    retryMarkRead: async () => {
      const error = get().markReadError;
      return error ? acknowledge(error.notificationId) : false;
    },

    openModal: () => set({ isModalOpen: true }),
    closeModal: () => set({ isModalOpen: false }),
  };
});

// Selector for unread count
export const useUnreadCount = () =>
  useNotificationStore((state) => state.notifications.filter((n) => !n.seen).length);
