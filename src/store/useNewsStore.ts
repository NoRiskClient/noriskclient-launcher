import { create } from "zustand";
import type { LauncherNewsItem, LauncherNewsPage } from "../types/launcherNews";

export const NEWS_PAGE_SIZE = 12;

interface NewsState {
  items: LauncherNewsItem[];
  page: number;
  totalPages: number;
  error: string | null;
}

interface NewsActions {
  setFirstPage: (page: LauncherNewsPage) => void;
  appendPage: (page: LauncherNewsPage) => void;
  setError: (error: string | null) => void;
}

const newestFirst = (items: LauncherNewsItem[]) => {
  const seen = new Set<string>();
  return items
    .filter((item) => !seen.has(item.id) && seen.add(item.id))
    .sort((a, b) => b.publishedAt - a.publishedAt);
};

export const useNewsStore = create<NewsState & NewsActions>()((set) => ({
  items: [],
  page: 0,
  totalPages: 1,
  error: null,

  setFirstPage: (first) =>
    set((state) => ({
      items: newestFirst([...first.items, ...(state.page > 1 ? state.items : [])]),
      page: Math.max(state.page, 1),
      totalPages: first.totalPages,
    })),

  appendPage: (next) =>
    set((state) => ({
      items: newestFirst([...state.items, ...next.items]),
      page: next.page,
      totalPages: next.totalPages,
    })),

  setError: (error) => set({ error }),
}));
