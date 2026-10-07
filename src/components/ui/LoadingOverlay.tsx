"use client";

import type React from "react";
import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { gsap } from "gsap";
import { useThemeStore } from "../../store/useThemeStore";
import { LoadingSpinner } from "./LoadingSpinner";
import { useAnimationsEnabled } from "../../hooks/useEntranceAnimation";

interface LoadingOverlayProps extends React.HTMLAttributes<HTMLDivElement> {
  isLoading: boolean;
  message?: string;
  variant?:
    | "default"
    | "secondary"
    | "warning"
    | "destructive"
    | "info"
    | "success";
  size?: "sm" | "md" | "lg" | "xl";
  shadowDepth?: "default" | "short" | "none";
  showProgressBar?: boolean;
  progress?: number;
}

export const LoadingOverlay = forwardRef<HTMLDivElement, LoadingOverlayProps>(
  (
    {
      isLoading,
      message = "Loading content...",
      className,
      variant = "default",
      size = "md",
      shadowDepth = "default",
      showProgressBar = true,
      progress = -1,
      ...props
    },
    ref,
  ) => {
    const overlayRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(isLoading);
    const accentColor = useThemeStore((state) => state.accentColor);
    const animationsEnabled = useAnimationsEnabled();
    const safeProgress = Number.isFinite(progress) && progress >= 0 ? Math.min(100, progress) : undefined;

    const mergedRef = (node: HTMLDivElement) => {
      if (ref) {
        if (typeof ref === "function") {
          ref(node);
        } else {
          ref.current = node;
        }
      }
      overlayRef.current = node;
    };

    useLayoutEffect(() => {
      const overlay = overlayRef.current;
      const content = contentRef.current;

      if (!overlay || !content) return;

      if (isLoading) {
        setIsVisible(true);
        gsap.set(overlay, { opacity: 1 });
        gsap.set(content, {
          scale: 1,
          y: 0,
          opacity: 1,
        });
      } else if (!animationsEnabled) {
        setIsVisible(false);
      } else {
        const tl = gsap.timeline();
        tl.to(content, {
          scale: 0.95,
          y: -20,
          opacity: 0,
          duration: 0.3,
          ease: "power2.in",
        })
          .to(
            overlay,
            { opacity: 0, duration: 0.3, ease: "power2.in" },
            "-=0.1",
          )
          .call(() => setIsVisible(false));
        return () => { tl.kill(); };
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
            container: "p-4 max-w-sm",
            spinner: "md",
            text: "text-base",
            progressHeight: "h-1.5",
          };        case "lg":
          return {
            container: "p-8 max-w-2xl",
            spinner: "xl",
            text: "text-xl",
            progressHeight: "h-3",
          };
        case "xl":
          return {
            container: "p-10 max-w-3xl",
            spinner: "xxl",
            text: "text-2xl",
            progressHeight: "h-4",
          };
        default:
          return {
            container: "p-6 max-w-lg",
            spinner: "lg",
            text: "text-lg",
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
          "absolute inset-0 z-10 flex items-center justify-center backdrop-blur-sm",
          className,
        )}
        style={{ backgroundColor: "rgba(0, 0, 0, 0.7)" }}
        {...props}
      >
        <div
          ref={contentRef}
          className={cn(
            "relative overflow-hidden rounded-md backdrop-blur-md",
            shadowDepth !== "none" && "border-2 border-b-4",
            sizeStyles.container,
          )}
          style={{
            backgroundColor: `${colors.main}30`,
            borderColor: `${colors.main}80`,
            borderBottomColor: colors.dark,
            boxShadow: getShadowStyle(),
          }}
        >
          <span
            className="absolute inset-x-0 top-0 h-[2px] rounded-t-sm"
            style={{ backgroundColor: `${colors.light}80` }}
          />

          <div className="flex flex-col items-center space-y-4">
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
                    width:
                      safeProgress !== undefined ? `${safeProgress}%` : "30%",
                    animation:
                      safeProgress === undefined && animationsEnabled
                        ? "loading-bar 2s ease-in-out infinite"
                        : "none",
                  }}
                ></div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);

LoadingOverlay.displayName = "LoadingOverlay";
