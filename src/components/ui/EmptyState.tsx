"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";
import { gsap } from "gsap";

interface EmptyStateProps {
  icon?: string;
  message: string;
  description?: string;
  className?: string;
  action?: React.ReactNode;
  fullHeight?: boolean;
  compact?: boolean;
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
  onIconClick,
}: EmptyStateProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
  const [isDelayedContentVisible, setIsDelayedContentVisible] = useState(false);

  useEffect(() => {
    const contentTimer = setTimeout(() => {
      setIsDelayedContentVisible(true);
    }, 150);

    if (isBackgroundAnimationEnabled) {
      if (containerRef.current) {
        gsap.fromTo(
          containerRef.current,
          { opacity: 0, y: 20, scale: 0.95 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.5,
            ease: "power2.out",
          },
        );
      }      if (iconRef.current) {
        gsap.fromTo(
          iconRef.current,
          { scale: 0.8, opacity: 0 },
          {
            scale: 1,
            opacity: 1,
            duration: 0.6,
            delay: 0.2,
            ease: "elastic.out(1.2, 0.5)",
          },
        );
      }
    } else {
      if (containerRef.current) {
        gsap.set(containerRef.current, { opacity: 1, y: 0, scale: 1 });
      }
      if (iconRef.current) {
        gsap.set(iconRef.current, { opacity: 1, scale: 1 });
      }
    }
    
    return () => {
      clearTimeout(contentTimer);
    };
  }, [isBackgroundAnimationEnabled]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex flex-col items-center justify-center rounded-lg backdrop-blur-sm",
        compact ? "p-4" : "p-8",
        fullHeight ? "h-full w-full" : "auto",
        className,
      )}
      style={{
        backgroundColor: `${accentColor.value}10`,
      }}
    >
      <div
        style={{
          opacity: isDelayedContentVisible ? 1 : 0,
          transition: "opacity 0.5s ease-in-out",
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
            onIconClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""
          )}
          style={{ color: accentColor.value }}
          onClick={onIconClick}
        >
          <Icon icon={icon} className={compact ? "w-12 h-12" : "w-20 h-20"} />
        </div>        <p
          className={cn(
            "text-white lowercase text-center mb-2",
            compact ? "text-lg" : "text-xl",
          )}
        >
          {message}
        </p>

        {description && (
          <p
            className={cn(
              "text-white/70 lowercase text-center max-w-md",
              compact ? "text-base mb-4" : "text-lg mb-6",
            )}
          >
            {description}
          </p>
        )}

        {action && isDelayedContentVisible && (
          <div 
            className="mt-4"
            style={{
              opacity: isDelayedContentVisible ? 1 : 0,
              transition: "opacity 0.5s ease-in-out 0.1s"
            }}
          >
            {action}
          </div>
        )}
      </div>
    </div>
  );
}
