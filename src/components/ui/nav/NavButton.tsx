"use client";

import type React from "react";
import { forwardRef, useRef } from "react";
import { cn } from "../../../lib/utils";
import { useThemeStore } from "../../../store/useThemeStore";

interface NavButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  isActive?: boolean;
  variant?: "default" | "secondary" | "ghost";
}

export const NavButton = forwardRef<HTMLButtonElement, NavButtonProps>(
  (
    { className, icon, isActive = false, variant = "default", ...props },
    ref,
  ) => {
    const buttonRef = useRef<HTMLButtonElement>(null);
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

    const baseClasses = cn(
      "font-minecraft relative overflow-hidden transition-all duration-300",
      "w-16 h-16 rounded-md text-white flex items-center justify-center",
      "text-shadow-sm",
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-1 focus-visible:ring-offset-black/20",
    );

    const activeStateClasses = cn(
      variant !== "ghost" && [
        "border-2 border-b-4",
        "shadow-[0_6px_0_rgba(0,0,0,0.25),0_8px_15px_rgba(0,0,0,0.3)]",
        "hover:translate-y-[-2px] hover:shadow-[0_8px_0_rgba(0,0,0,0.2),0_10px_20px_rgba(0,0,0,0.25)]",
        "active:translate-y-[2px] active:shadow-[0_3px_0_rgba(0,0,0,0.15),0_4px_8px_rgba(0,0,0,0.2)]",
      ],
      "hover:brightness-110 active:brightness-90",
    );
    
    const activeStateStyles: React.CSSProperties = variant === "ghost" ? {} : {
      backgroundColor: `${colors.main}40`,
      borderColor: `${colors.main}90`,
      borderTopColor: colors.light,
      borderBottomColor: colors.dark,
      boxShadow: `0 6px 0 rgba(0,0,0,0.25), 0 8px 15px rgba(0,0,0,0.3), inset 0 1px 0 ${colors.light}40, inset 0 0 0 1px ${colors.main}20`,
      color: colors.text,
    };

    const nonActiveStateClasses = cn(
      variant !== "ghost" && [
        "hover:translate-y-[-2px]",
        "active:translate-y-[1px]",
      ],
      "hover:brightness-110 active:brightness-90",
    );

    const nonActiveStateStyles: React.CSSProperties = {};
    if (isActive) {
      Object.assign(nonActiveStateStyles, activeStateStyles);
    } else {
      nonActiveStateStyles.color = `${colors.text}90`;
    }

    return (
      <button
        ref={ref || buttonRef}
        className={cn(
          baseClasses,
          isActive ? activeStateClasses : nonActiveStateClasses,
          className,
        )}
        style={isActive ? activeStateStyles : { ...nonActiveStateStyles, borderColor: "transparent" }}
        {...props}
      >
        <span
          className={cn(
            "absolute inset-0 bg-gradient-radial from-white/30 via-transparent to-transparent",
            isActive
              ? "opacity-30"
              : "opacity-0 transition-opacity duration-300",
          )}
        />
        <span className="relative z-10 flex items-center justify-center w-8 h-8">
          {icon}
        </span>
      </button>
    );
  },
);

NavButton.displayName = "NavButton";
