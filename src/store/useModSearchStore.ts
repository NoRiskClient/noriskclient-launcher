import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ModrinthProjectType } from "../types/modrinth";
import { UnifiedSortType } from "../types/unified";
import type { UnifiedModSearchResult } from "../types/unified";

interface ModSearchState {
  searchTerm: string;
  projectType: ModrinthProjectType;
  sortOrder: UnifiedSortType;
  selectedCategoriesByProjectType: Record<ModrinthProjectType, string[]>;
  selectedLoadersByProjectType: Record<ModrinthProjectType, string[]>;
  selectedGameVersions: string[];
  filterClientRequired: boolean;
  filterServerRequired: boolean;
  scrollPosition: number;
  offset: number;
  searchResults: UnifiedModSearchResult[];
  totalHits: number;

  setSearchTerm: (term: string) => void;
  setProjectType: (type: ModrinthProjectType) => void;
  setSortOrder: (sort: UnifiedSortType) => void;
  setSelectedCategoriesByProjectType: (
    updater:
      | Record<ModrinthProjectType, string[]>
      | ((prev: Record<ModrinthProjectType, string[]>) => Record<ModrinthProjectType, string[]>)
  ) => void;
  setSelectedLoadersByProjectType: (
    updater:
      | Record<ModrinthProjectType, string[]>
      | ((prev: Record<ModrinthProjectType, string[]>) => Record<ModrinthProjectType, string[]>)
  ) => void;
  setSelectedGameVersions: (
    updater: string[] | ((prev: string[]) => string[])
  ) => void;
  setFilterClientRequired: (value: boolean) => void;
  setFilterServerRequired: (value: boolean) => void;
  setScrollPosition: (pos: number) => void;
  setOffset: (updater: number | ((prev: number) => number)) => void;
  setSearchResults: (
    updater:
      | UnifiedModSearchResult[]
      | ((prev: UnifiedModSearchResult[]) => UnifiedModSearchResult[])
  ) => void;
  setTotalHits: (hits: number) => void;
  resetFilters: () => void;
}

const DEFAULT_CATEGORIES_STATE: Record<ModrinthProjectType, string[]> = {
  mod: [],
  modpack: [],
  resourcepack: [],
  shader: [],
  datapack: [],
};

export const useModSearchStore = create<ModSearchState>()(
  persist(
    (set) => ({
      searchTerm: "",
      projectType: "mod",
      sortOrder: UnifiedSortType.Relevance,
      selectedCategoriesByProjectType: { ...DEFAULT_CATEGORIES_STATE },
      selectedLoadersByProjectType: { ...DEFAULT_CATEGORIES_STATE },
      selectedGameVersions: [],
      filterClientRequired: false,
      filterServerRequired: false,
      scrollPosition: 0,
      offset: 0,
      searchResults: [],
      totalHits: 0,

      setSearchTerm: (term) => set({ searchTerm: term }),
      setProjectType: (type) => set({ projectType: type }),
      setSortOrder: (sort) => set({ sortOrder: sort }),
      setSelectedCategoriesByProjectType: (updater) =>
        set((state) => ({
          selectedCategoriesByProjectType:
            typeof updater === "function"
              ? updater(state.selectedCategoriesByProjectType)
              : updater,
        })),
      setSelectedLoadersByProjectType: (updater) =>
        set((state) => ({
          selectedLoadersByProjectType:
            typeof updater === "function"
              ? updater(state.selectedLoadersByProjectType)
              : updater,
        })),
      setSelectedGameVersions: (updater) =>
        set((state) => ({
          selectedGameVersions:
            typeof updater === "function"
              ? updater(state.selectedGameVersions)
              : updater,
        })),
      setFilterClientRequired: (value) => set({ filterClientRequired: value }),
      setFilterServerRequired: (value) => set({ filterServerRequired: value }),
      setScrollPosition: (pos) => set({ scrollPosition: pos }),
      setOffset: (updater) =>
        set((state) => ({
          offset: typeof updater === "function" ? updater(state.offset) : updater,
        })),
      setSearchResults: (updater) =>
        set((state) => ({
          searchResults:
            typeof updater === "function"
              ? updater(state.searchResults)
              : updater,
        })),
      setTotalHits: (hits) => set({ totalHits: hits }),
      resetFilters: () =>
        set({
          searchTerm: "",
          projectType: "mod",
          sortOrder: UnifiedSortType.Relevance,
          selectedCategoriesByProjectType: { ...DEFAULT_CATEGORIES_STATE },
          selectedLoadersByProjectType: { ...DEFAULT_CATEGORIES_STATE },
          selectedGameVersions: [],
          filterClientRequired: false,
          filterServerRequired: false,
          scrollPosition: 0,
          offset: 0,
          searchResults: [],
          totalHits: 0,
        }),
    }),
    {
      name: "norisk-mod-search",
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
