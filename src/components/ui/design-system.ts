import type { AccentColor } from "../../store/useThemeStore";

export type ComponentSize = "xs" | "sm" | "md" | "lg" | "xl";
export type ComponentVariant = "default" | "flat" | "3d" | "elevated" | "secondary" | "flat-secondary" | "ghost" | "warning" | "destructive" | "info" | "success";
export type StateVariant = "error" | "success" | "warning" | "info";

export interface DesignConfig {
  isRoundTheme?: boolean;
  accentColor?: AccentColor;
  isAnimationEnabled?: boolean;
  borderRadius?: number;
}

export interface ColorTokens {
  main: string;
  light: string;
  dark: string;
  text: string;
}

export const designTokens = {
  spacing: {
    xs: "0.5rem",
    sm: "0.75rem", 
    md: "1rem",
    lg: "1.25rem",
    xl: "1.5rem"
  },
  typography: {
    xs: "0.75rem",
    sm: "0.875rem",
    md: "1rem", 
    lg: "1.125rem",
    xl: "1.25rem"
  },
  animations: {
    fast: "0.15s",
    normal: "0.2s",
    slow: "0.3s"
  },
  shadows: {
    sm: "0 2px 4px rgba(0,0,0,0.1)",
    md: "0 4px 8px rgba(0,0,0,0.15)",
    lg: "0 8px 16px rgba(0,0,0,0.2)"
  }
};

export const getVariantColors = (variant: ComponentVariant, accentColor: AccentColor): ColorTokens => {
  switch (variant) {
    case "warning":
      return {
        main: "#f59e0b",
        light: "#fbbf24", 
        dark: "#d97706",
        text: "#fef3c7"
      };
    case "destructive":
      return {
        main: "#ef4444",
        light: "#f87171",
        dark: "#dc2626", 
        text: "#fee2e2"
      };
    case "info":
      return {
        main: "#3b82f6",
        light: "#60a5fa",
        dark: "#2563eb",
        text: "#dbeafe"
      };
    case "success":
      return {
        main: "#10b981",
        light: "#34d399",
        dark: "#059669",
        text: "#d1fae5"
      };
    case "secondary":
      return {
        main: "#6b7280",
        light: "#9ca3af",
        dark: "#4b5563",
        text: "#f3f4f6"
      };
    case "ghost":
      return {
        main: "transparent",
        light: "transparent", 
        dark: "transparent",
        text: "#ffffff"
      };
    default:
      return {
        main: accentColor.value,
        light: accentColor.hoverValue || accentColor.value,
        dark: accentColor.value,
        text: "#ffffff"
      };
  }
};

export const getSizeClasses = (size: ComponentSize, element: "button" | "input" | "badge" = "button"): string => {  if (element === "badge") {
    switch (size) {
      case "xs": return "px-1.5 py-0.5 text-xs min-h-[18px]";
      case "sm": return "px-1.5 py-0.5 text-xs min-h-[20px]";
      case "md": return "px-2 py-1 text-sm min-h-[24px]";
      case "lg": return "px-2.5 py-1 text-base min-h-[28px]";
      case "xl": return "px-3 py-1.5 text-lg min-h-[32px]";
      default: return "px-2 py-1 text-sm min-h-[24px]";
    }
  }
  
  if (element === "input") {
    switch (size) {
      case "xs": return "h-[36px] px-5 text-lg";
      case "sm": return "h-[42px] px-6 text-xl";
      case "md": return "h-[50px] px-8 text-xl";
      case "lg": return "h-[58px] px-10 text-2xl";
      case "xl": return "h-[66px] px-12 text-2xl";
      default: return "h-[50px] px-8 text-xl";
    }
  }
  
  switch (size) {
    case "xs": return "h-[36px] px-5 py-2 text-lg";
    case "sm": return "h-[42px] px-6 py-2 text-xl"; 
    case "md": return "h-[50px] px-8 py-2.5 text-xl";
    case "lg": return "h-[58px] px-10 py-3 text-2xl";
    case "xl": return "h-[66px] px-12 py-4 text-2xl";
    default: return "h-[50px] px-8 py-2.5 text-xl";
  }
};

export const getAccessibilityProps = (props: {
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}): Record<string, any> => {
  const accessibilityProps: Record<string, any> = {};
  
  if (props.label) {
    accessibilityProps["aria-label"] = props.label;
  }
  
  if (props.description) {
    accessibilityProps["aria-describedby"] = `desc-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  if (props.error) {
    accessibilityProps["aria-invalid"] = true;
    accessibilityProps["aria-describedby"] = `error-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  if (props.required) {
    accessibilityProps["aria-required"] = true;
  }
  
  if (props.disabled) {
    accessibilityProps["aria-disabled"] = true;
  }
  
  return accessibilityProps;
};

export const getBorderRadiusStyle = (borderRadius?: number): React.CSSProperties => {
  if (borderRadius === undefined) {
    return { borderRadius: "var(--border-radius)" };
  }
  return { borderRadius: `${borderRadius}px` };
};

export const getBorderRadiusClass = (borderRadius?: number): string => {
  return "rounded-[var(--border-radius)]";
};

export const createRadiusStyle = (borderRadius?: number, multiplier?: number): React.CSSProperties => {
  if (borderRadius === undefined) {
    return { borderRadius: "var(--border-radius)" };
  }
  
  if (borderRadius === 0) {
    return { borderRadius: "0px" };
  }
  
  const adjustedRadius = multiplier ? Math.round(borderRadius * multiplier) : borderRadius;
  return { borderRadius: `${adjustedRadius}px` };
};

export const getRadiusClasses = (borderRadius?: number, element?: string): string => {
  return getBorderRadiusClass(borderRadius);
};

export const getTextSizeClass = (size: ComponentSize, element: "button" | "input" | "badge" | "label" | "checkbox" = "label"): string => {  if (element === "badge") {
    switch (size) {
      case "xs": return "text-xs";
      case "sm": return "text-xs";
      case "md": return "text-sm";
      case "lg": return "text-base";
      case "xl": return "text-lg";
      default: return "text-sm";
    }
  }
  
  if (element === "input") {
    switch (size) {
      case "xs": return "text-lg";
      case "sm": return "text-xl";
      case "md": return "text-xl";
      case "lg": return "text-2xl";
      case "xl": return "text-2xl";
      default: return "text-xl";
    }
  }
    if (element === "button") {
    switch (size) {
      case "xs": return "text-lg";
      case "sm": return "text-xl";
      case "md": return "text-xl";
      case "lg": return "text-2xl";
      case "xl": return "text-2xl";
      default: return "text-xl";
    }
  }
  
  if (element === "checkbox") {
    switch (size) {
      case "xs": return "text-xl";
      case "sm": return "text-2xl";
      case "md": return "text-2xl";
      case "lg": return "text-3xl";
      case "xl": return "text-3xl";
      default: return "text-2xl";
    }
  }
  
  switch (size) {
    case "xs": return "text-lg";
    case "sm": return "text-xl";
    case "md": return "text-xl";
    case "lg": return "text-2xl";
    case "xl": return "text-2xl";
    default: return "text-xl";
  }
};
