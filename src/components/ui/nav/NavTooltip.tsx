"use client";

import type React from "react";
import { forwardRef } from "react";
import { cn } from "../../../lib/utils";
import { useThemeStore } from "../../../store/useThemeStore";

interface NavTooltipProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "ghost";
}

export const NavTooltip = forwardRef<HTMLDivElement, NavTooltipProps>(
  ({ className, children, variant = "default", ...props }, ref) => {
    const accentColor = useThemeStore((state) => state.accentColor);

    const getVariantColors = () => {
      switch (variant) {
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
        default:
          return {
            main: accentColor.value,
            light: accentColor.hoverValue,
            dark: accentColor.value,
            text: "#ffffff",
          };
      }
    };

    const colors = getVariantColors();

    return (
      <div
        ref={ref}
        className={cn(
          "font-smallcaps relative overflow-hidden backdrop-blur-md",
          "px-4 py-2 rounded-md text-white whitespace-nowrap",
          "text-shadow-sm text-base",
          "border-2 shadow-[0_4px_0_rgba(0,0,0,0.2),0_6px_10px_rgba(0,0,0,0.25)]",
          className,
        )}
        style={{
          backgroundColor:
            variant === "ghost" ? "transparent" : `${colors.main}30`,
          borderColor: variant === "ghost" ? "transparent" : `${colors.main}80`,
          borderBottomColor: variant === "ghost" ? "transparent" : colors.dark,
          boxShadow:
            variant === "ghost"
              ? "none"
              : `0 4px 0 rgba(0,0,0,0.2), 0 6px 10px rgba(0,0,0,0.25), inset 0 1px 0 ${colors.light}40, inset 0 0 0 1px ${colors.main}20`,
          color: colors.text,
        }}
        {...props}
      >
        <span className="absolute inset-0 opacity-20 bg-gradient-radial from-white/20 via-transparent to-transparent" />
        <span className="relative z-10">{children}</span>
      </div>
    );
  },
);

NavTooltip.displayName = "NavTooltip";
