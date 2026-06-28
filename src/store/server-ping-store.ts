import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ServerPingInfo } from "../types/minecraft";
import { pingMinecraftServer } from "../services/world-service";

interface CachedPing {
  info: ServerPingInfo;
  timestamp: number;
}

interface ServerPingState {
  cache: Record<string, CachedPing>;
  pinging: Set<string>;
  // Subscribers for updates
  subscribers: Record<string, Set<(info: ServerPingInfo) => void>>;

  // Get cached ping immediately, triggers background refresh
  getPing: (address: string) => ServerPingInfo | null;

  // Subscribe to ping updates for a server
  subscribe: (address: string, callback: (info: ServerPingInfo) => void) => () => void;

  // Trigger a background ping (doesn't block, updates cache when done)
  triggerBackgroundPing: (address: string) => void;

  // Clear cache for a specific server or all
  clearCache: (address?: string) => void;
}

export const useServerPingStore = create<ServerPingState>()(
  persist(
    (set, get) => ({
  cache: {},
  pinging: new Set(),
  subscribers: {},

  getPing: (address: string) => {
    const { cache } = get();
    const cached = cache[address];

    // Always trigger background refresh
    get().triggerBackgroundPing(address);

    // Return cached value immediately (even if stale), or null if no cache
    if (cached && !cached.info.error) {
      console.log(`[ServerPingStore] Returning cached ping for ${address}`);
      return cached.info;
    }

    return null;
  },

  subscribe: (address: string, callback: (info: ServerPingInfo) => void) => {
    set((state) => {
      const addressSubs = state.subscribers[address] || new Set();
      addressSubs.add(callback);
      return {
        subscribers: {
          ...state.subscribers,
          [address]: addressSubs
        }
      };
    });

    // Return unsubscribe function
    return () => {
      set((state) => {
        const addressSubs = state.subscribers[address];
        if (addressSubs) {
          addressSubs.delete(callback);
        }
        return { subscribers: { ...state.subscribers } };
      });
    };
  },

  triggerBackgroundPing: (address: string) => {
    const { pinging } = get();

    // Don't ping if already pinging
    if (pinging.has(address)) {
      console.log(`[ServerPingStore] Already pinging ${address}, skipping`);
      return;
    }

    // Mark as pinging
    set((state) => ({
      pinging: new Set([...state.pinging, address])
    }));

    // Ping in background
    console.log(`[ServerPingStore] Background pinging ${address}...`);
    pingMinecraftServer(address)
      .then((info) => {
        // Only update cache if ping was successful (no error)
        if (!info.error) {
          console.log(`[ServerPingStore] Background ping successful for ${address}`);
          set((state) => ({
            cache: {
              ...state.cache,
              [address]: { info, timestamp: Date.now() }
            },
            pinging: new Set([...state.pinging].filter(a => a !== address))
          }));

          // Notify subscribers
          const { subscribers } = get();
          const addressSubs = subscribers[address];
          if (addressSubs) {
            addressSubs.forEach(callback => callback(info));
          }
        } else {
          console.log(`[ServerPingStore] Background ping failed for ${address}:`, info.error);
          // Still remove from pinging set, but don't update cache with error
          set((state) => ({
            pinging: new Set([...state.pinging].filter(a => a !== address))
          }));
        }
      })
      .catch((err) => {
        console.error(`[ServerPingStore] Background ping error for ${address}:`, err);
        set((state) => ({
          pinging: new Set([...state.pinging].filter(a => a !== address))
        }));
      });
  },

  clearCache: (address?: string) => {
    if (address) {
      set((state) => {
        const newCache = { ...state.cache };
        delete newCache[address];
        return { cache: newCache };
      });
    } else {
      set({ cache: {} });
    }
  },
    }),
    {
      name: "server-ping-cache",
      // Only persist the cache, not runtime state like pinging/subscribers
      partialize: (state) => ({ cache: state.cache }),
    }
  )
);
