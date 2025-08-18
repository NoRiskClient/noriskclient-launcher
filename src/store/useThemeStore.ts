import { create } from "zustand";
import { persist } from "zustand/middleware";
import { setProfileGroupingPreference } from "../services/launcher-config-service";

export type AccentColor = {
  name: string;
  value: string;
  hoverValue: string;
  shadowValue: string;
  light: string;
  dark: string;
  isCustom?: boolean;
};

export const ACCENT_COLORS: Record<string, AccentColor> = {
  cyan: {
    name: "Cyan",
    value: "#00B9E8",
    hoverValue: "#0099CC",
    shadowValue: "rgba(0, 185, 232, 0.5)",
    light: "#22d3ee",
    dark: "#0891b2",
  },
  blue: {
    name: "Blue",
    value: "#4f8eff",
    hoverValue: "#3a7aff",
    shadowValue: "rgba(79, 142, 255, 0.5)",
    light: "#60a5fa",
    dark: "#2563eb",
  },
  purple: {
    name: "Purple",
    value: "#9c5fff",
    hoverValue: "#8a4aff",
    shadowValue: "rgba(156, 95, 255, 0.5)",
    light: "#a78bfa",
    dark: "#7c3aed",
  },
  violet: {
    name: "Violet",
    value: "#8b5cf6",
    hoverValue: "#7c3aed",
    shadowValue: "rgba(139, 92, 246, 0.5)",
    light: "#a78bfa",
    dark: "#6d28d9",
  },
  pink: {
    name: "Pink",
    value: "#ec4899",
    hoverValue: "#db2777",
    shadowValue: "rgba(236, 72, 153, 0.5)",
    light: "#f472b6",
    dark: "#be185d",
  },
  green: {
    name: "Green",
    value: "#10b981",
    hoverValue: "#059669",
    shadowValue: "rgba(16, 185, 129, 0.5)",
    light: "#34d399",
    dark: "#047857",
  },
  emerald: {
    name: "Emerald",
    value: "#059669",
    hoverValue: "#047857",
    shadowValue: "rgba(5, 150, 105, 0.5)",
    light: "#10b981",
    dark: "#065f46",
  },
  teal: {
    name: "Teal",
    value: "#14b8a6",
    hoverValue: "#0d9488",
    shadowValue: "rgba(20, 184, 166, 0.5)",
    light: "#2dd4bf",
    dark: "#0f766e",
  },
  orange: {
    name: "Orange",
    value: "#f97316",
    hoverValue: "#ea580c",
    shadowValue: "rgba(249, 115, 22, 0.5)",
    light: "#fb923c",
    dark: "#c2410c",
  },
  amber: {
    name: "Amber",
    value: "#f59e0b",
    hoverValue: "#d97706",
    shadowValue: "rgba(245, 158, 11, 0.5)",
    light: "#fbbf24",
    dark: "#b45309",
  },
  red: {
    name: "Red",
    value: "#ef4444",
    hoverValue: "#dc2626",
    shadowValue: "rgba(239, 68, 68, 0.5)",
    light: "#f87171",
    dark: "#b91c1c",
  },
  rose: {
    name: "Rose",
    value: "#f43f5e",
    hoverValue: "#e11d48",
    shadowValue: "rgba(244, 63, 94, 0.5)",
    light: "#fb7185",
    dark: "#be123c",
  },
  indigo: {
    name: "Indigo",
    value: "#6366f1",
    hoverValue: "#4f46e5",
    shadowValue: "rgba(99, 102, 241, 0.5)",
    light: "#818cf8",
    dark: "#3730a3",
  },
  slate: {
    name: "Slate",
    value: "#64748b",
    hoverValue: "#475569",
    shadowValue: "rgba(100, 116, 139, 0.5)",
    light: "#94a3b8",
    dark: "#334155",
  },
  steel: {
    name: "Steel",
    value: "#8b9dc3",
    hoverValue: "#6b7fa3",
    shadowValue: "rgba(139, 157, 195, 0.5)",
    light: "#a8b8d8",
    dark: "#5a6b8a",
  },
  charcoal: {
    name: "Charcoal",
    value: "#6b7280",
    hoverValue: "#4b5563",
    shadowValue: "rgba(107, 114, 128, 0.5)",
    light: "#9ca3af",
    dark: "#374151",
  },
};

const calculateColorVariants = (baseColor: string): Partial<AccentColor> => {
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: Number.parseInt(result[1], 16),
          g: Number.parseInt(result[2], 16),
          b: Number.parseInt(result[3], 16),
        }
      : null;
  };

  const rgbToHex = (r: number, g: number, b: number) => {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  };

  const darken = (hex: string, amount: number) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;

    return rgbToHex(
      Math.max(0, Math.floor(rgb.r * (1 - amount))),
      Math.max(0, Math.floor(rgb.g * (1 - amount))),
      Math.max(0, Math.floor(rgb.b * (1 - amount))),
    );
  };

  const lighten = (hex: string, amount: number) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;

    return rgbToHex(
      Math.min(255, Math.floor(rgb.r + (255 - rgb.r) * amount)),
      Math.min(255, Math.floor(rgb.g + (255 - rgb.g) * amount)),
      Math.min(255, Math.floor(rgb.b + (255 - rgb.b) * amount)),
    );
  };

  const calculateShadow = (hex: string) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return `rgba(0, 0, 0, 0.5)`;

    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)`;
  };

  return {
    value: baseColor,
    hoverValue: darken(baseColor, 0.1),
    shadowValue: calculateShadow(baseColor),
    light: lighten(baseColor, 0.2),
    dark: darken(baseColor, 0.2),
    isCustom: true,
  };
};

export const DEFAULT_BORDER_RADIUS = 0; 
export const MIN_BORDER_RADIUS = 0;
export const MAX_BORDER_RADIUS = 32;

interface ThemeState {
  accentColor: AccentColor;
  setAccentColor: (color: AccentColor) => void;
  setCustomAccentColor: (hexColor: string) => void;
  applyAccentColorToDOM: () => void;
  customColorHistory: string[];
  addToCustomColorHistory: (hexColor: string) => void;
  clearCustomColorHistory: () => void;
  isBackgroundAnimationEnabled: boolean;
  isDetailViewSidebarOnLeft: boolean;
  toggleDetailViewSidebarPosition: () => void;
  profileGroupingCriterion: string;
  setProfileGroupingCriterion: (criterion: string) => Promise<void>;
  staticBackground: boolean;
  toggleStaticBackground: () => void;
  toggleBackgroundAnimation: () => void;
  hasAcceptedTermsOfService: boolean;
  acceptTermsOfService: () => void;
  borderRadius: number;
  setBorderRadius: (radius: number) => void;
  applyBorderRadiusToDOM: () => void;
  collapsedProfileGroups: string[];
  setCollapsedProfileGroups: (groups: string[]) => void;
  toggleCollapsedProfileGroup: (groupKey: string) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      accentColor: ACCENT_COLORS.blue,
      isBackgroundAnimationEnabled: false,
      isDetailViewSidebarOnLeft: true,
      profileGroupingCriterion: "group",
      staticBackground: true,
      hasAcceptedTermsOfService: false,
      customColorHistory: [],
      borderRadius: DEFAULT_BORDER_RADIUS,
      collapsedProfileGroups: [],

      setAccentColor: (color: AccentColor) => {
        set({ accentColor: color });
        get().applyAccentColorToDOM();
      },

      setBorderRadius: (radius: number) => {
        const clampedRadius = Math.max(MIN_BORDER_RADIUS, Math.min(MAX_BORDER_RADIUS, radius));
        set({ borderRadius: clampedRadius });
        get().applyBorderRadiusToDOM();
      },

      setCustomAccentColor: (hexColor: string) => {
        const colorVariants = calculateColorVariants(hexColor);
        const customColor: AccentColor = {
          name: "Custom",
          ...colorVariants,
        } as AccentColor;

        set({ accentColor: customColor });
        get().applyAccentColorToDOM();
        get().addToCustomColorHistory(hexColor);
      },

      addToCustomColorHistory: (hexColor: string) => {
        set((state) => {
          const newHistory = [...state.customColorHistory];
          
          const existingIndex = newHistory.indexOf(hexColor);
          if (existingIndex > -1) {
            newHistory.splice(existingIndex, 1);
          }
          
          newHistory.unshift(hexColor);
          
          if (newHistory.length > 10) {
            newHistory.pop();
          }
          
          return { customColorHistory: newHistory };
        });
      },

      clearCustomColorHistory: () => {
        set({ customColorHistory: [] });
      },

      toggleBackgroundAnimation: () => {
        set((state) => ({
          isBackgroundAnimationEnabled: !state.isBackgroundAnimationEnabled,
        }));
      },

      toggleDetailViewSidebarPosition: () => {
        set((state) => ({
          isDetailViewSidebarOnLeft: !state.isDetailViewSidebarOnLeft,
        }));
      },

      setProfileGroupingCriterion: async (criterion: string) => {
        try {
          await setProfileGroupingPreference(criterion);
          set({ profileGroupingCriterion: criterion });
        } catch (error) {
          console.error("Failed to save grouping preference:", error);
          set({ profileGroupingCriterion: criterion });
          throw error;
        }
      },

      toggleStaticBackground: () => {
        set((state) => ({ staticBackground: !state.staticBackground }));
      },      acceptTermsOfService: () => {
        set({ hasAcceptedTermsOfService: true });      },      applyAccentColorToDOM: () => {
        const { accentColor } = get();

        const hexToRgb = (hex: string) => {
          const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
          return result
            ? `${Number.parseInt(result[1], 16)}, ${Number.parseInt(result[2], 16)}, ${Number.parseInt(result[3], 16)}`
            : null;
        };

        document.documentElement.style.setProperty(
          "--accent",
          accentColor.value,
        );
        document.documentElement.style.setProperty(
          "--accent-hover",
          accentColor.hoverValue,
        );
        document.documentElement.style.setProperty(
          "--accent-shadow",
          accentColor.shadowValue,
        );
        document.documentElement.style.setProperty(
          "--accent-light",
          accentColor.light,
        );
        document.documentElement.style.setProperty(
          "--accent-dark",
          accentColor.dark,
        );

        const rgbValue = hexToRgb(accentColor.value);
        if (rgbValue) {
          document.documentElement.style.setProperty("--accent-rgb", rgbValue);
        }
      },      applyBorderRadiusToDOM: () => {
        const { borderRadius } = get();
        
        document.documentElement.style.setProperty("--border-radius", `${borderRadius}px`);
        
        document.documentElement.setAttribute("data-border-radius", borderRadius.toString());
        if (borderRadius === 0) {
          document.documentElement.classList.add("radius-flat");
        } else {
          document.documentElement.classList.remove("radius-flat");
        }
      },

      setCollapsedProfileGroups: (groups: string[]) => {
        set({ collapsedProfileGroups: [...groups] });
      },

      toggleCollapsedProfileGroup: (groupKey: string) => {
        set((state) => {
          const isCollapsed = state.collapsedProfileGroups.includes(groupKey);
          const next = isCollapsed
            ? state.collapsedProfileGroups.filter((g) => g !== groupKey)
            : [...state.collapsedProfileGroups, groupKey];
          return { collapsedProfileGroups: next };
        });
      },
    }),    {
      name: "norisk-theme-storage",
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Migration: Replace old "none" grouping criterion with "group"
          if (state.profileGroupingCriterion === "none") {
            state.profileGroupingCriterion = "group";
          }
          
          state.applyAccentColorToDOM();
          state.applyBorderRadiusToDOM();
          // Ensure collapsedProfileGroups exists after rehydrate
          if (!Array.isArray(state.collapsedProfileGroups)) {
            state.collapsedProfileGroups = [];
          }
        }
      },
    },
  ),
);
