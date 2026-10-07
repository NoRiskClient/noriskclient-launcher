"use client";

import type React from "react";
import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { gsap } from "gsap";
import { useThemeStore } from "../../store/useThemeStore";
import { LoadingSpinner } from "./LoadingSpinner";
import { useAnimationsEnabled } from "../../hooks/useEntranceAnimation";

interface LoadingStateProps extends React.HTMLAttributes<HTMLDivElement> {
  message?: string;
  variant?:
    | "default"
    | "secondary"
    | "warning"
    | "destructive"
    | "info"
    | "success";
  size?: "sm" | "md" | "lg";
  shadowDepth?: "default" | "short" | "none";
  showProgressBar?: boolean;
  progress?: number;
  isLoading?: boolean;
}

export const LoadingState = forwardRef<HTMLDivElement, LoadingStateProps>(
  (
    {
      message = "Loading...",
      className,
      variant = "default",
      size = "md",
      shadowDepth = "default",
      showProgressBar = true,
      progress = -1,
      isLoading = true,
      ...props
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const accentColor = useThemeStore((state) => state.accentColor);
    const animationsEnabled = useAnimationsEnabled();
    const safeProgress = Number.isFinite(progress) && progress >= 0 ? Math.min(100, progress) : undefined;
    const [isVisible, setIsVisible] = useState(isLoading);

    const mergedRef = (node: HTMLDivElement) => {
      if (ref) {
        if (typeof ref === "function") {
          ref(node);
        } else {
          ref.current = node;
        }
      }
      containerRef.current = node;
    };

    useLayoutEffect(() => {
      if (!containerRef.current) return;
      if (isLoading) {
        setIsVisible(true);
        gsap.set(containerRef.current, { opacity: 1, y: 0 });
      } else if (!animationsEnabled) {
        setIsVisible(false);
      } else {
        const tween = gsap.to(containerRef.current, {
          opacity: 0,
          duration: 0.3,
          ease: "power2.in",
          onComplete: () => setIsVisible(false),
        });
        return () => { tween.kill(); };
      }
    }, [isLoading, animationsEnabled]);

    useLayoutEffect(() => {
      if (progressRef.current && safeProgress !== undefined && showProgressBar) {
        const tween = gsap.to(progressRef.current, {
          width: `${safeProgress}%`,
          duration: animationsEnabled ? 0.4 : 0,
          ease: "power1.out",
        });
        return () => { tween.kill(); };
      }
    }, [safeProgress, showProgressBar, animationsEnabled, isLoading]);

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
        case "sm":
          return {
            container: "p-3",
            spinner: "sm",
            text: "text-sm",
            progressHeight: "h-1.5",
          };
        case "lg":
          return {
            container: "p-6",
            spinner: "lg",
            text: "text-xl",
            progressHeight: "h-3",
          };
        default:
          return {
            container: "p-4",
            spinner: "md",
            text: "text-base",
            progressHeight: "h-2",
          };
      }
    };

    const colors = getVariantColors();
    const sizeStyles = getSizeStyles();

    const getShadowStyle = () => {
      if (shadowDepth === "none") return "none";

      if (shadowDepth === "short") {
        return `0 4px 0 rgba(0,0,0,0.3), 0 6px 10px rgba(0,0,0,0.35), inset 0 1px 0 ${colors.light}40, inset 0 0 0 1px ${colors.main}20`;
      }

      return `0 8px 0 rgba(0,0,0,0.3), 0 10px 15px rgba(0,0,0,0.35), inset 0 1px 0 ${colors.light}40, inset 0 0 0 1px ${colors.main}20`;
    };

    if (!isLoading && !isVisible) return null;

    return (
      <div
        ref={mergedRef}
        role="status"
        aria-live="polite"
        aria-busy={isLoading}
        className={cn(
          "flex flex-col items-center justify-center space-y-4 rounded-md backdrop-blur-md",
          shadowDepth !== "none" && "border-2 border-b-4",
          sizeStyles.container,
          className,
        )}
        style={{
          backgroundColor: `${colors.main}30`,
          borderColor: `${colors.main}80`,
          borderBottomColor: colors.dark,
          boxShadow: getShadowStyle(),
        }}
        {...props}
      >
        <span
          className="absolute inset-x-0 top-0 h-[2px] rounded-t-sm"
          style={{ backgroundColor: `${colors.light}80` }}
        />

        <LoadingSpinner
          variant={variant}
          size={sizeStyles.spinner as any}
          shadowDepth="none"
        />

        <p
          className={cn("text-center tracking-wider", sizeStyles.text)}
          style={{ color: colors.text }}
        >
          {message}
        </p>

        {showProgressBar && (
          <div
            role="progressbar"
            aria-label={message}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={safeProgress}
            className={cn(
              "w-full overflow-hidden rounded-full bg-black/20",
              sizeStyles.progressHeight,
            )}
            style={{ boxShadow: "inset 0 1px 2px rgba(0,0,0,0.3)" }}
          >
            <div
              ref={progressRef}
              className={cn("h-full rounded-full", animationsEnabled && "transition-all")}
              style={{
                backgroundColor: colors.text,
                width: safeProgress !== undefined ? `${safeProgress}%` : "30%",
                animation:
                  safeProgress === undefined && animationsEnabled ? "loading-bar 2s ease-in-out infinite" : "none",
              }}
            ></div>
          </div>
        )}
      </div>
    );
  },
);

LoadingState.displayName = "LoadingState";
