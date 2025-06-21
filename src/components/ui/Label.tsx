"use client";

import type React from "react";
import { forwardRef, useRef } from "react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";

interface LabelProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?:
    | "default"
    | "secondary"
    | "ghost"
    | "warning"
    | "destructive"
    | "info"
    | "success"
    | "flat"
    | "3d";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  withAnimation?: boolean;
}

export const Label = forwardRef<HTMLDivElement, LabelProps>(
  (
    {
      children,
      className,
      variant = "default",
      size = "md",
      icon,
      iconPosition = "left",
      withAnimation = true,
      ...props
    },
    ref,
  ) => {
    const labelRef = useRef<HTMLDivElement>(null);
    const accentColor = useThemeStore((state) => state.accentColor);

    const mergedRef = (node: HTMLDivElement) => {
      if (ref) {
        if (typeof ref === "function") {
          ref(node);
        } else {
          ref.current = node;
        }
      }
      labelRef.current = node;
    };

    const getVariantColors = () => {
      switch (variant) {
        case "warning":
          return {
            main: "#f59e0b",
            light: "#fbbf24",
            dark: "#d97706",
            text: "#fef3c7",
          };
        case "destructive":
          return {
            main: "#ef4444",
            light: "#f87171",
            dark: "#dc2626",
            text: "#fee2e2",
          };
        case "info":
          return {
            main: "#3b82f6",
            light: "#60a5fa",
            dark: "#2563eb",
            text: "#dbeafe",
          };
        case "success":
          return {
            main: "#10b981",
            light: "#34d399",
            dark: "#059669",
            text: "#d1fae5",
          };
        case "secondary":
          return {
            main: "#6b7280",
            light: "#9ca3af",
            dark: "#4b5563",
            text: "#f3f4f6",
          };
        case "ghost":
          return {
            main: "transparent",
            light: "transparent",
            dark: "transparent",
            text: "#ffffff",
          };
        case "flat":
          return {
            main: accentColor.value,
            light: accentColor.hoverValue || accentColor.value,
            dark: accentColor.value,
            text: "#ffffff",
          };
        default:
          return {
            main: accentColor.value,
            light: accentColor.hoverValue || accentColor.value,
            dark: accentColor.value,
            text: "#ffffff",
          };
      }
    };

    const colors = getVariantColors();    const sizeStyles = {
      xs: "h-[32px] py-1 px-3 text-xs",
      sm: "h-[42px] py-1 px-3 text-base",
      md: "h-[50px] py-1.5 px-4 text-lg",
      lg: "h-[58px] py-2 px-5 text-xl",
      xl: "h-[66px] py-2.5 px-6 text-xl",
    };

    const iconSizes = {
      xs: "w-3 h-3",
      sm: "w-4 h-4",
      md: "w-5 h-5",
      lg: "w-6 h-6",
      xl: "w-7 h-7",
    };

    const getBorderClasses = () => {
      if (variant === "ghost") {
        return "";
      }
      if (variant === "3d") {
        return "border-2 border-b-4";
      }
      return "border border-b-2";
    };

    const getBackgroundColor = () => {
      if (variant === "ghost") {
        return "transparent";
      }
      return `${colors.main}30`;
    };

    const getBorderColor = () => {
      if (variant === "ghost") {
        return "transparent";
      }
      return `${colors.main}80`;
    };

    const getBorderBottomColor = () => {
      if (variant === "ghost") {
        return "transparent";
      }
      return colors.dark;
    };

    return (
      <div
        ref={mergedRef}
        className={cn(
          "font-minecraft relative overflow-hidden backdrop-blur-md",
          "rounded-md text-white tracking-wider",
          "inline-flex items-center justify-center",
          "text-shadow-sm",
          getBorderClasses(),
          sizeStyles[size],
          className,
        )}
        style={{
          backgroundColor: getBackgroundColor(),
          borderColor: getBorderColor(),
          borderBottomColor: getBorderBottomColor(),
          color: colors.text,
          boxShadow: variant === "3d" ? undefined : "none",
        }}
        {...props}
      >
        {variant === "3d" && (
          <span
            className="absolute inset-x-0 top-0 h-[2px] rounded-t-sm"
            style={{
              backgroundColor: `${colors.light}80`,
              opacity: 0.8,
            }}
          />
        )}

        {variant === "3d" && (
          <>
            <span
              className="absolute inset-y-0 left-0 w-[1px]"
              style={{ backgroundColor: `${colors.light}40` }}
            />
            <span
              className="absolute inset-y-0 right-0 w-[1px]"
              style={{ backgroundColor: `${colors.dark}40` }}
            />
          </>
        )}

        {icon && iconPosition === "left" && (
          <span
            className={cn(
              "flex items-center justify-center mr-1.5",
              iconSizes[size],
            )}
          >
            {icon}
          </span>
        )}
        <span className="relative z-10">{children}</span>
        {icon && iconPosition === "right" && (
          <span
            className={cn(
              "flex items-center justify-center ml-1.5",
              iconSizes[size],
            )}
          >
            {icon}
          </span>
        )}
      </div>
    );
  },
);

Label.displayName = "Label";
