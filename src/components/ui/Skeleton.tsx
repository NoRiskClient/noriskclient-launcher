"use client";

import type React from "react";
import { forwardRef, useEffect, useRef } from "react";
import { cn } from "../../lib/utils";
import { gsap } from "gsap";
import { useThemeStore } from "../../store/useThemeStore";
import { getBorderRadiusClass } from "./design-system";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "text" | "image" | "block";
  width?: number | string;
  height?: number | string;
  lines?: number;
  animated?: boolean;
  shadowDepth?: "default" | "short" | "none";
}

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  (
    {
      className,
      variant = "block",
      width,
      height,
      lines = 1,
      animated = true,
      shadowDepth = "short",
      ...props
    },
    ref,
  ) => {
    const skeletonRef = useRef<HTMLDivElement>(null);
    const accentColor = useThemeStore((state) => state.accentColor);
    const isBackgroundAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
    const radiusClass = getBorderRadiusClass();

    const mergedRef = (node: HTMLDivElement) => {
      if (ref) {
        if (typeof ref === "function") {
          ref(node);
        } else {
          ref.current = node;
        }
      }
      skeletonRef.current = node;
    };

    useEffect(() => {
      if (skeletonRef.current && isBackgroundAnimationEnabled) {
        const animation = gsap.fromTo(
          skeletonRef.current,
          { scale: 0.95, opacity: 0 },
          {
            scale: 1,
            opacity: 1,
            duration: 0.4,
            ease: "power2.out",
          },
        );

        return () => {
          if (animation.totalTime() < 0.5) {
            animation.progress(1);
          }
        };
      }
    }, [isBackgroundAnimationEnabled]);

    const getShadowStyle = () => {
      if (shadowDepth === "none") return "none";

      if (shadowDepth === "short") {
        return `0 4px 0 rgba(0,0,0,0.3), 0 6px 10px rgba(0,0,0,0.35), inset 0 1px 0 ${accentColor.value}20, inset 0 0 0 1px ${accentColor.value}10`;
      }

      return `0 8px 0 rgba(0,0,0,0.3), 0 10px 15px rgba(0,0,0,0.35), inset 0 1px 0 ${accentColor.value}20, inset 0 0 0 1px ${accentColor.value}10`;
    };

    const getVariantStyles = () => {
      switch (variant) {
        case "text":
          return {
            height: height || "1.25rem",
            width: width || "100%",
            borderRadius: "0.25rem",
          };
        case "image":
          return {
            height: height || "12rem",
            width: width || "100%",
            borderRadius: "0.375rem",
          };
        default:
          return {
            height: height || "5rem",
            width: width || "100%",
            borderRadius: "0.375rem",
          };
      }
    };

    const variantStyles = getVariantStyles();    if (variant === "text" && lines > 1) {
      return (
        <div
          className={cn("flex flex-col gap-2", className)}
          ref={mergedRef}
          {...props}
        >
          {Array.from({ length: lines }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "relative overflow-hidden backdrop-blur-sm transition-all duration-200",
                radiusClass,
                "border-2",
                shadowDepth !== "none" && "border-b-4",
                animated && "animate-skeleton-pulse",
              )}
              style={{
                height: variantStyles.height,
                width:
                  i === lines - 1 && lines > 1 ? "75%" : variantStyles.width,
                backgroundColor: `${accentColor.value}15`,
                borderColor: `${accentColor.value}30`,
                borderBottomColor:
                  shadowDepth !== "none"
                    ? `${accentColor.value}40`
                    : `${accentColor.value}30`,
                boxShadow: getShadowStyle(),
              }}
            >
              <span
                className="absolute inset-x-0 top-0 h-[2px] rounded-t-sm"
                style={{ backgroundColor: `${accentColor.value}40` }}
              />
            </div>
          ))}
        </div>
      );
    }

    return (
      <div
        ref={mergedRef}
        className={cn(
          "relative overflow-hidden backdrop-blur-sm transition-all duration-200",
          radiusClass,
          "border-2",
          shadowDepth !== "none" && "border-b-4",
          animated && "animate-skeleton-pulse",
          className,
        )}
        style={{
          height: variantStyles.height,
          width: variantStyles.width,
          backgroundColor: `${accentColor.value}15`,
          borderColor: `${accentColor.value}30`,
          borderBottomColor:
            shadowDepth !== "none"
              ? `${accentColor.value}40`
              : `${accentColor.value}30`,
          boxShadow: getShadowStyle(),
        }}
        {...props}
      >
        <span
          className="absolute inset-x-0 top-0 h-[2px] rounded-t-sm"
          style={{ backgroundColor: `${accentColor.value}40` }}
        />

        {animated && (
          <div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
            style={{
              animation: "skeleton-shimmer 2s infinite",
              backgroundSize: "200% 100%",
            }}
          />
        )}
      </div>
    );
  },
);

Skeleton.displayName = "Skeleton";
