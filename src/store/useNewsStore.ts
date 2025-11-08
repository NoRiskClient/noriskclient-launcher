import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BlogPost } from "../../types/wordPress";

interface NewsState {
  posts: BlogPost[];
  isLoading: boolean;
  error: string | null;
  lastFetched: number | null;
  setPosts: (posts: BlogPost[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  isCacheValid: () => boolean;
}

export const useNewsStore = create<NewsState>()(
  persist(
    (set, get) => ({
      posts: [],
      isLoading: true,
      error: null,
      lastFetched: null,
      setPosts: (posts: BlogPost[]) =>
        set({ posts, isLoading: false, error: null, lastFetched: Date.now() }),
      setLoading: (isLoading: boolean) => set({ isLoading }),
      setError: (error: string | null) => set({ error, isLoading: false }),
      isCacheValid: () => {
        const { lastFetched } = get();
        if (!lastFetched) {
          return false;
        }
        // Cache is valid for 5 minutes
        return Date.now() - lastFetched < 5 * 60 * 1000;
      },
    }),
    {
      name: "news-storage",
    },
  ),
);
