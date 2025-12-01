import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AccentColor } from "./useThemeStore";

export interface LauncherTheme {
  id: string;
  name: string;
  accentColor: AccentColor;
  backgroundImage?: string; // Path to background image (only for play screen)
  unlockRequirement?: {
    type: "advent-door";
    day: number;
  };
}

export const LAUNCHER_THEMES: Record<string, LauncherTheme> = {
  christmas_theme: {
    id: "christmas_theme",
    name: "Christmas Theme",
    accentColor: {
      name: "Christmas Blue",
      value: "#4A90D9",
      hoverValue: "#3A7BC8",
      light: "#6BA3E3",
      dark: "#2E5A8A",
      shadowValue: "rgba(74, 144, 217, 0.5)",
      isCustom: true,
    },
    backgroundImage: "/themes/christmas_theme.png",
    unlockRequirement: {
      type: "advent-door",
      day: 2,
    },
  },
};

interface LauncherThemeState {
  // Currently selected theme (null means no theme, use custom accent color)
  selectedThemeId: string | null;
  // Track which advent calendar doors have been opened (persisted)
  openedAdventDoors: number[];
  // Original accent color before theme was applied (to restore when deselecting)
  originalAccentColor: AccentColor | null;
  // Actions
  selectTheme: (themeId: string | null) => void;
  markAdventDoorOpened: (day: number) => void;
  isThemeUnlocked: (themeId: string) => boolean;
  setOriginalAccentColor: (color: AccentColor | null) => void;
  getSelectedTheme: () => LauncherTheme | null;
}

export const useLauncherThemeStore = create<LauncherThemeState>()(
  persist(
    (set, get) => ({
      selectedThemeId: null,
      openedAdventDoors: [],
      originalAccentColor: null,

      selectTheme: (themeId: string | null) => {
        set({ selectedThemeId: themeId });
      },

      markAdventDoorOpened: (day: number) => {
        set((state) => {
          if (state.openedAdventDoors.includes(day)) {
            return state;
          }
          return {
            openedAdventDoors: [...state.openedAdventDoors, day].sort((a, b) => a - b),
          };
        });
      },

      isThemeUnlocked: (themeId: string) => {
        const theme = LAUNCHER_THEMES[themeId];
        if (!theme) return false;

        // No unlock requirement means it's always unlocked
        if (!theme.unlockRequirement) return true;

        const { openedAdventDoors } = get();

        if (theme.unlockRequirement.type === "advent-door") {
          return openedAdventDoors.includes(theme.unlockRequirement.day);
        }

        return false;
      },

      setOriginalAccentColor: (color: AccentColor | null) => {
        set({ originalAccentColor: color });
      },

      getSelectedTheme: () => {
        const { selectedThemeId } = get();
        if (!selectedThemeId) return null;
        return LAUNCHER_THEMES[selectedThemeId] || null;
      },
    }),
    {
      name: "launcher-theme-storage",
    }
  )
);

