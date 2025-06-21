"use client";

import type React from "react";
import { forwardRef, useEffect, useRef } from "react";
import { cn } from "../../lib/utils";
import { gsap } from "gsap";
import { useThemeStore } from "../../store/useThemeStore";
import { Icon } from "@iconify/react";

interface LoadingSpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "xxl";
  variant?:
    | "default"
    | "secondary"
    | "warning"
    | "destructive"
    | "info"
    | "success";
  message?: string;
  showMessage?: boolean;
  shadowDepth?: "default" | "short" | "none";
}

export const LoadingSpinner = forwardRef<HTMLDivElement, LoadingSpinnerProps>(
  (
    {
      size = "md",
      variant = "default",
      message,
      showMessage = true,
      className,
      shadowDepth = "short",
      ...props
    },
    ref,
  ) => {
    const spinnerRef = useRef<HTMLDivElement>(null);
    const accentColor = useThemeStore((state) => state.accentColor);
    const isBackgroundAnimationEnabled = useThemeStore(
      (state) => state.isBackgroundAnimationEnabled,
    );

    const mergedRef = (node: HTMLDivElement) => {
      if (ref) {
        if (typeof ref === "function") {
          ref(node);
        } else {
          ref.current = node;
        }
      }
      spinnerRef.current = node;
    };

    useEffect(() => {
      if (spinnerRef.current && isBackgroundAnimationEnabled) {
        gsap.set(spinnerRef.current, { scale: 1, opacity: 1 });
      }
    }, [isBackgroundAnimationEnabled]);

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
        default:
          return {
            main: accentColor.value,
            light: accentColor.hoverValue || accentColor.value,
            dark: accentColor.value,
            text: "#ffffff",
          };
      }
    };

    const getSizeStyles = () => {
      switch (size) {
        case "xs":
          return { icon: "h-6 w-6", text: "text-xs", textMarginTop: "mt-2" };
        case "sm":
          return { icon: "h-8 w-8", text: "text-sm", textMarginTop: "mt-2" };
        case "lg":
          return { icon: "h-16 w-16", text: "text-lg", textMarginTop: "mt-3" };        case "xl":
          return { icon: "h-20 w-20", text: "text-lg", textMarginTop: "mt-3" };
        case "xxl":
          return { icon: "h-24 w-24", text: "text-xl", textMarginTop: "mt-4" };
        default:
          return {
            icon: "h-12 w-12",
            text: "text-base",
            textMarginTop: "mt-2.5",
          };
      }
    };

    const getShadowStyle = () => {
      if (shadowDepth === "none") return "none";

      const colors = getVariantColors();

      if (shadowDepth === "short") {
        return `0 2px 0 rgba(0,0,0,0.15), 0 3px 5px rgba(0,0,0,0.2), inset 0 1px 0 ${colors.light}30, inset 0 0 0 1px ${colors.main}15`;
      }

      return `0 4px 0 rgba(0,0,0,0.15), 0 5px 8px rgba(0,0,0,0.25), inset 0 1px 0 ${colors.light}30, inset 0 0 0 1px ${colors.main}15`;
    };

    const colors = getVariantColors();
    const sizeStyles = getSizeStyles();

    return (
      <div
        ref={mergedRef}
        className={cn(
          "flex flex-col items-center justify-center",
          shadowDepth !== "none" && "rounded-md border-2 backdrop-blur-sm p-4",
          className,
        )}
        style={{
          backgroundColor:
            shadowDepth !== "none" ? `${colors.main}30` : "transparent",
          borderColor:
            shadowDepth !== "none" ? `${colors.main}80` : "transparent",
          boxShadow: getShadowStyle(),
        }}
        {...props}
      >
        {shadowDepth !== "none" && (
          <span
            className="absolute inset-x-0 top-0 h-[1px] rounded-t-sm"
            style={{ backgroundColor: `${colors.light}80` }}
          />
        )}

        <div className="relative flex items-center justify-center">
          <Icon
            icon="solar:refresh-bold"
            className={cn("animate-spin", sizeStyles.icon)}
            style={{ color: colors.text }}
          />

          <div
            className="absolute rounded-full animate-pulse"
            style={{
              inset: "0",
              backgroundColor: "transparent",
              boxShadow: `0 0 15px ${colors.text}40`,
              opacity: 0.6,
            }}
          />
        </div>

        {showMessage && message && (
          <p
            className={cn(
              "text-center tracking-wider",
              sizeStyles.text,
              sizeStyles.textMarginTop,
            )}
            style={{ color: colors.text }}
          >
            {message}
          </p>
        )}
      </div>
    );
  },
);

LoadingSpinner.displayName = "LoadingSpinner";
