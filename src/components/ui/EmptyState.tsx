"use client";

import type React from "react";
import { useRef } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";
import { useEntranceAnimation } from "../../hooks/useEntranceAnimation";

interface EmptyStateProps {
  icon?: string;
  message: string;
  description?: string;
  className?: string;
  action?: React.ReactNode;
  fullHeight?: boolean;
  compact?: boolean;
  /**
   * Render the description one step below the message instead of at the same
   * size. Opt-in so existing empty states are untouched: today the description
   * is `text-2xl` in both the compact and the regular branch, i.e. exactly as
   * large as the heading above it, which looks like an oversight rather than a
   * decision worth propagating silently.
   */
  smallDescription?: boolean;
  onIconClick?: () => void;
}

export function EmptyState({
  icon = "solar:info-circle-bold",
  message,
  description,
  className,
  action,
  fullHeight = true,
  compact = false,
  smallDescription = false,
  onIconClick,
}: EmptyStateProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const accentColor = useThemeStore((state) => state.accentColor);
  useEntranceAnimation(containerRef, { opacity: 0, y: 20, scale: 0.95 },
    { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: "power2.out" });
  useEntranceAnimation(iconRef, { scale: 0.8, opacity: 0 },
    { scale: 1, opacity: 1, duration: 0.6, delay: 0.2, ease: "elastic.out(1.2, 0.5)" });
  useEntranceAnimation(contentRef, { opacity: 0 }, { opacity: 1, duration: 0.5, delay: 0.15 });

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col items-center justify-center",
        compact ? "p-4" : "p-8",
        fullHeight ? "h-full w-full" : "auto",
        className,
      )}
    >
      <div
        ref={contentRef}
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          ref={iconRef}
          className={cn(
            "flex items-center justify-center text-white mb-4",
            compact ? "w-20 h-12" : "w-28 h-20",
            onIconClick ? "cursor-pointer hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80" : ""
          )}
          style={{ color: accentColor.value }}
          onClick={onIconClick}
          role={onIconClick ? "button" : undefined}
          tabIndex={onIconClick ? 0 : undefined}
          aria-label={onIconClick ? message : undefined}
          onKeyDown={event => {
            if (onIconClick && !event.repeat && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onIconClick(); }
          }}
        >
          <Icon icon={icon} className={compact ? "w-12 h-12" : "w-20 h-20"} />
        </div>        <p
          className={cn(
            "text-white lowercase text-center mb-2",
            compact ? "text-xl" : "text-2xl",
          )}
        >
          {message}
        </p>

        {description && (
          <p
            className={cn(
              "text-white/70 lowercase text-center max-w-md",
              smallDescription
                ? (compact ? "text-base mb-4" : "text-lg mb-6")
                : (compact ? "text-2xl mb-4" : "text-2xl mb-6"),
            )}
          >
            {description}
          </p>
        )}

        {action && (
          <div className="mt-2">
            {action}
          </div>
        )}
      </div>
    </div>
  );
}
