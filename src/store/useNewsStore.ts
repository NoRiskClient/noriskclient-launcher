import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BlogPost } from "../types/wordPress";

interface NewsState {
  posts: BlogPost[];
  lastFetched: number | null;
  isLoading: boolean;
  error: string | null;
}

interface NewsActions {
  setPosts: (posts: BlogPost[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearCache: () => void;
  isCacheValid: () => boolean;
}

export const useNewsStore = create<NewsState & NewsActions>()(
  persist(
    (set, get) => ({
      posts: [],
      lastFetched: null,
      isLoading: false,
      error: null,

      setPosts: (posts) => set({ posts, lastFetched: Date.now() }),
      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),

      clearCache: () => set({ posts: [], lastFetched: null, error: null }),

      isCacheValid: () => {
        const { lastFetched } = get();
        if (!lastFetched) return false;

        // Cache ist 1 Stunde gültig
        const CACHE_DURATION = 60 * 60 * 1000; // 1 Stunde in Millisekunden
        return Date.now() - lastFetched < CACHE_DURATION;
      },
    }),
    {
      name: "news-store",
      // Nur posts und lastFetched persistieren
      partialize: (state) => ({
        posts: state.posts,
        lastFetched: state.lastFetched,
      }),
    }
  )
);
