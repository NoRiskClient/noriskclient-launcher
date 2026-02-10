import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export type OnlineState = 'ONLINE' | 'OFFLINE' | 'AFK' | 'BUSY' | 'INVISIBLE';

export interface FriendsFriendUser {
  uuid: string;
  username: string;
  state: OnlineState;
  server: string | null;
  pingEnabled: boolean | null;
}

export interface FriendsUser {
  uuid: string;
  username: string;
  state: OnlineState;
  server: string | null;
  privacy: {
    showServer: boolean;
    allowRequests: boolean;
    allowServerInvites: boolean;
  };
}

export interface FriendRequestUser {
  uuid: string;
  username: string;
}

export interface FriendRequestWithUsers {
  id: string;
  sender: string;
  receiver: string;
  state: 'PENDING' | 'ACCEPTED' | 'DENIED' | 'WITHDRAWN' | 'NONE';
  timestamp: number;
  users: FriendRequestUser[];
}

interface FriendsState {
  friends: FriendsFriendUser[];
  pendingRequests: FriendRequestWithUsers[];
  currentUser: FriendsUser | null;
  isLoading: boolean;
  isSidebarOpen: boolean;
  isSettingsOpen: boolean;
  wsConnected: boolean;
  notificationsEnabled: boolean;
  error: string | null;
  activeChatFriend: FriendsFriendUser | null;
  lastFetchedAt: number | null;

  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;

  loadFriends: (force?: boolean) => Promise<void>;
  loadPendingRequests: () => Promise<void>;
  loadCurrentUser: () => Promise<void>;

  sendRequest: (name: string) => Promise<void>;
  acceptRequest: (name: string) => Promise<void>;
  denyRequest: (name: string) => Promise<void>;
  removeFriend: (name: string, uuid: string) => Promise<void>;

  setStatus: (state: OnlineState) => Promise<void>;
  togglePing: (friendName: string) => Promise<boolean>;

  connectWebSocket: () => Promise<void>;
  disconnectWebSocket: () => Promise<void>;

  updateFriendStatus: (uuid: string, state: OnlineState) => void;
  updateFriendServer: (uuid: string, server: string | null) => void;
  updateFriendState: (uuid: string, state: OnlineState, server?: string) => void;
  addFriend: (friend: FriendsFriendUser) => void;
  removeFriendFromList: (uuid: string) => void;
  removeFriendByUuid: (uuid: string) => void;
  setWsConnected: (connected: boolean) => void;
  addPendingRequest: (request: FriendRequestWithUsers) => void;
  removePendingRequest: (id: string) => void;
  openChat: (friend: FriendsFriendUser) => void;
  closeChat: () => void;
  toggleNotifications: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  updatePrivacySetting: (setting: string, value: boolean) => Promise<void>;
}

export const useFriendsStore = create<FriendsState>((set, get) => ({
  friends: [],
  pendingRequests: [],
  currentUser: null,
  isLoading: false,
  isSidebarOpen: false,
  isSettingsOpen: false,
  wsConnected: false,
  notificationsEnabled: true,
  error: null,
  activeChatFriend: null,
  lastFetchedAt: null,

  openSidebar: () => set({ isSidebarOpen: true }),
  closeSidebar: () => set({ isSidebarOpen: false }),
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  loadFriends: async (force = false) => {
    const state = get();
    const now = Date.now();
    const staleTime = 30_000; // 30 seconds

    // Skip if we have data and it's not stale (unless forced)
    if (!force && state.friends.length > 0 && state.lastFetchedAt && (now - state.lastFetchedAt) < staleTime) {
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const friends = await invoke<FriendsFriendUser[]>('get_friends');
      set({ friends, isLoading: false, lastFetchedAt: now });
    } catch (e) {
      set({ error: String(e), isLoading: false });
    }
  },

  loadPendingRequests: async () => {
    try {
      const pendingRequests = await invoke<FriendRequestWithUsers[]>('get_pending_requests');
      set({ pendingRequests });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadCurrentUser: async () => {
    try {
      const currentUser = await invoke<FriendsUser>('get_friends_user');
      set({ currentUser });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  sendRequest: async (name: string) => {
    try {
      await invoke('send_friend_request', { targetName: name });
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  acceptRequest: async (name: string) => {
    try {
      await invoke('accept_friend_request', { targetName: name });
      set((state) => ({
        pendingRequests: state.pendingRequests.filter(
          (r) => !r.users.some((u) => u.username === name)
        ),
      }));
      await get().loadFriends();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  denyRequest: async (name: string) => {
    try {
      await invoke('deny_friend_request', { targetName: name });
      set((state) => ({
        pendingRequests: state.pendingRequests.filter(
          (r) => !r.users.some((u) => u.username === name)
        ),
      }));
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  removeFriend: async (name: string, uuid: string) => {
    try {
      await invoke('remove_friend', { targetName: name, targetUuid: uuid });
      set((state) => ({
        friends: state.friends.filter((f) => f.uuid !== uuid),
      }));
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  setStatus: async (status: OnlineState) => {
    try {
      const newStatus = await invoke<OnlineState>('set_online_status', { status });
      set((state) => ({
        currentUser: state.currentUser
          ? { ...state.currentUser, state: newStatus }
          : null,
      }));
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  togglePing: async (friendName: string) => {
    try {
      const enabled = await invoke<boolean>('toggle_friend_ping', { friendName });
      set((state) => ({
        friends: state.friends.map((f) =>
          f.username === friendName ? { ...f, pingEnabled: enabled } : f
        ),
      }));
      return enabled;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  connectWebSocket: async () => {
    try {
      await invoke('connect_friends_websocket');
    } catch (e) {
      set({ error: String(e) });
    }
  },

  disconnectWebSocket: async () => {
    try {
      await invoke('disconnect_friends_websocket');
      set({ wsConnected: false });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  updateFriendStatus: (uuid: string, state: OnlineState) => {
    set((s) => ({
      friends: s.friends.map((f) =>
        f.uuid === uuid ? { ...f, state } : f
      ),
    }));
  },

  updateFriendServer: (uuid: string, server: string | null) => {
    set((s) => ({
      friends: s.friends.map((f) =>
        f.uuid === uuid ? { ...f, server } : f
      ),
    }));
  },

  updateFriendState: (uuid: string, state: OnlineState, server?: string) => {
    set((s) => ({
      friends: s.friends.map((f) =>
        f.uuid === uuid ? { ...f, state, server: server ?? f.server } : f
      ),
    }));
  },

  addFriend: (friend: FriendsFriendUser) => {
    set((s) => ({
      friends: [...s.friends.filter((f) => f.uuid !== friend.uuid), friend],
    }));
  },

  removeFriendFromList: (uuid: string) => {
    set((s) => ({
      friends: s.friends.filter((f) => f.uuid !== uuid),
    }));
  },

  removeFriendByUuid: (uuid: string) => {
    set((s) => ({
      friends: s.friends.filter((f) => f.uuid !== uuid),
    }));
  },

  setWsConnected: (connected: boolean) => {
    set({ wsConnected: connected });
  },

  addPendingRequest: (request: FriendRequestWithUsers) => {
    set((s) => ({
      pendingRequests: [...s.pendingRequests, request],
    }));
  },

  removePendingRequest: (id: string) => {
    set((s) => ({
      pendingRequests: s.pendingRequests.filter((r) => r.id !== id),
    }));
  },

  openChat: (friend: FriendsFriendUser) => set({ activeChatFriend: friend, isSettingsOpen: false }),
  closeChat: () => set({ activeChatFriend: null }),
  toggleNotifications: () => set((s) => ({ notificationsEnabled: !s.notificationsEnabled })),
  openSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen, activeChatFriend: null })),
  closeSettings: () => set({ isSettingsOpen: false }),
  updatePrivacySetting: async (setting: string, value: boolean) => {
    try {
      await invoke('update_privacy_setting', { setting, value });
      set((state) => ({
        currentUser: state.currentUser
          ? {
              ...state.currentUser,
              privacy: {
                ...state.currentUser.privacy,
                [setting === 'showServer' ? 'showServer' : setting === 'allowRequests' ? 'allowRequests' : 'allowServerInvites']: value,
              },
            }
          : null,
      }));
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },
}));
