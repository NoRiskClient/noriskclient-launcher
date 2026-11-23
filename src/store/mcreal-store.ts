import { create } from "zustand";
import type { McRealPostWithRating, McRealSort } from "../types/mcreal";
import {
  getMcRealFeed,
  getMcRealTodayPost,
  rateMcRealPost,
  unrateMcRealPost,
} from "../services/mcreal-service";
import { getPlayerProfileByUuidOrName } from "../services/cape-service";
import { parseErrorMessage } from "../utils/error-utils";

export type McRealFeedTab = "friends" | "discovery" | "partners";

const PAGE_SIZE = 10;

interface McRealState {
  activeTab: McRealFeedTab;
  sort: McRealSort;
  posts: McRealPostWithRating[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  todayPost: McRealPostWithRating | null;
  /** uuid -> username cache */
  usernames: Record<string, string>;

  setTab: (tab: McRealFeedTab) => void;
  setSort: (sort: McRealSort) => void;
  loadFeed: (reset?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  refreshTodayPost: () => Promise<void>;
  ratePost: (postId: string, isPositive: boolean) => Promise<void>;
  removePost: (postId: string) => void;
  resolveUsername: (uuid: string) => Promise<void>;
}

export const useMcRealStore = create<McRealState>((set, get) => ({
  activeTab: "friends",
  sort: "NEWEST",
  posts: [],
  page: 0,
  hasMore: true,
  loading: false,
  loadingMore: false,
  error: null,
  todayPost: null,
  usernames: {},

  setTab: (tab) => {
    if (get().activeTab === tab) return;
    set({ activeTab: tab });
    void get().loadFeed(true);
  },

  setSort: (sort) => {
    if (get().sort === sort) return;
    set({ sort });
    void get().loadFeed(true);
  },

  loadFeed: async (reset = true) => {
    const { activeTab, sort } = get();
    if (reset) {
      set({ loading: true, error: null, page: 0, posts: [], hasMore: true });
    }
    try {
      const posts = await getMcRealFeed(
        activeTab === "friends",
        0,
        sort,
        activeTab === "partners",
      );
      set({
        posts,
        page: 0,
        hasMore: posts.length >= PAGE_SIZE,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: parseErrorMessage(e) });
    }
  },

  loadMore: async () => {
    const { activeTab, sort, page, hasMore, loadingMore, loading, posts } =
      get();
    if (!hasMore || loadingMore || loading) return;
    set({ loadingMore: true });
    try {
      const nextPage = page + 1;
      const next = await getMcRealFeed(
        activeTab === "friends",
        nextPage,
        sort,
        activeTab === "partners",
      );
      const known = new Set(posts.map((p) => p.post._id));
      set({
        posts: [...posts, ...next.filter((p) => !known.has(p.post._id))],
        page: nextPage,
        hasMore: next.length >= PAGE_SIZE,
        loadingMore: false,
      });
    } catch (e) {
      set({ loadingMore: false, error: parseErrorMessage(e) });
    }
  },

  refreshTodayPost: async () => {
    try {
      const todayPost = await getMcRealTodayPost();
      set({ todayPost });
    } catch {
      set({ todayPost: null });
    }
  },

  ratePost: async (postId, isPositive) => {
    const { posts } = get();
    const previous = posts;

    // Optimistic update; rollback on API failure.
    set({
      posts: posts.map((entry) => {
        if (entry.post._id !== postId) return entry;
        const had = entry.userRating;
        let { likes, dislikes } = entry;
        if (had) {
          if (had.isPositive) likes--;
          else dislikes--;
        }
        // Same button again = remove rating.
        if (had && had.isPositive === isPositive) {
          return { ...entry, likes, dislikes, userRating: null };
        }
        if (isPositive) likes++;
        else dislikes++;
        return {
          ...entry,
          likes,
          dislikes,
          userRating: { user: "", isPositive },
        };
      }),
    });

    try {
      const target = previous.find((p) => p.post._id === postId);
      if (target?.userRating && target.userRating.isPositive === isPositive) {
        await unrateMcRealPost(postId);
      } else {
        await rateMcRealPost(postId, isPositive);
      }
    } catch (e) {
      set({ posts: previous, error: parseErrorMessage(e) });
    }
  },

  removePost: (postId) =>
    set({ posts: get().posts.filter((p) => p.post._id !== postId) }),

  resolveUsername: async (uuid) => {
    if (get().usernames[uuid]) return;
    // Reserve the slot so concurrent cards don't fire duplicate lookups.
    set({ usernames: { ...get().usernames, [uuid]: "" } });
    try {
      const profile = await getPlayerProfileByUuidOrName(uuid);
      if (profile?.name) {
        set({ usernames: { ...get().usernames, [uuid]: profile.name } });
      }
    } catch {
      // Leave empty; card falls back to a shortened uuid.
    }
  },
}));
