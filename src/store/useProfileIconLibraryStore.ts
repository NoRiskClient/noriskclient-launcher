import { create } from "zustand";
import { persist } from "zustand/middleware";

// Personal library of custom profile icons the user has added in the IconPicker.
// Persisted to localStorage so it survives launcher restarts.

export interface CustomIcon {
  /** Stable local id. */
  id: string;
  /** "file" -> absolute path on disk, "url" -> remote image URL. */
  kind: "file" | "url";
  /** The absolute file path or the image URL. */
  value: string;
}

interface ProfileIconLibraryState {
  customIcons: CustomIcon[];
  addCustomFile: (path: string) => void;
  addCustomUrl: (url: string) => void;
  removeCustomIcon: (id: string) => void;
}

const STORAGE_KEY = "norisk-profile-icon-library";

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const useProfileIconLibraryStore = create<ProfileIconLibraryState>()(
  persist(
    (set) => ({
      customIcons: [],

      addCustomFile: (path: string) => {
        set((state) => {
          if (state.customIcons.some((i) => i.kind === "file" && i.value === path)) {
            return state;
          }
          return {
            customIcons: [
              { id: genId(), kind: "file", value: path },
              ...state.customIcons,
            ],
          };
        });
      },

      addCustomUrl: (url: string) => {
        set((state) => {
          if (state.customIcons.some((i) => i.kind === "url" && i.value === url)) {
            return state;
          }
          return {
            customIcons: [
              { id: genId(), kind: "url", value: url },
              ...state.customIcons,
            ],
          };
        });
      },

      removeCustomIcon: (id: string) => {
        set((state) => ({
          customIcons: state.customIcons.filter((i) => i.id !== id),
        }));
      },
    }),
    {
      name: STORAGE_KEY,
      onRehydrateStorage: () => (state) => {
        if (state && !Array.isArray(state.customIcons)) {
          state.customIcons = [];
        }
      },
    },
  ),
);
