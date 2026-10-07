"use client";

import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { forwardRef, useCallback, useRef, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { PlayerHead } from "../common/PlayerHead";
import { useEntranceAnimation } from "../../hooks/useEntranceAnimation";

interface CurrentAccountDisplayProps {
  expanded: boolean;
  menuId: string;
  onClick?: () => void;
  className?: string;
  compact?: boolean;
  variant?: "default" | "flat";
}

export const CurrentAccountDisplay = forwardRef<HTMLButtonElement, CurrentAccountDisplayProps>(function CurrentAccountDisplay({
  expanded,
  menuId,
  onClick,
  className,
  compact = false,
  variant = "flat",
}: CurrentAccountDisplayProps, forwardedRef) {
  const { activeAccount } = useMinecraftAuthStore();
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const assignButtonRef = useCallback((node: HTMLButtonElement | null) => {
    buttonRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.focus({ preventScroll: true });
    onClick?.();
  };
  const [isHovered, setIsHovered] = useState(false);
  useEntranceAnimation(
    buttonRef,
    { scale: 0.95, opacity: 0 },
    { scale: 1, opacity: 1, duration: 0.4, ease: "power2.out" },
  );

  // Get border classes based on variant
  const getBorderClasses = () => {
    if (variant === "flat") {
      return "border border-b-2";
    }
    return "border-2 border-b-4";
  };

  // Get box shadow based on variant
  const getBoxShadow = () => {
    if (variant === "flat") {
      return "none";
    }
    return `0 8px 0 rgba(0,0,0,0.3), 0 10px 15px rgba(0,0,0,0.35), inset 0 1px 0 ${accentColor.value}40, inset 0 0 0 1px ${accentColor.value}20`;
  };

  // Get hover box shadow based on variant
  const getHoverBoxShadow = () => {
    if (variant === "flat") {
      return "none";
    }
    return "0 10px 0 rgba(0,0,0,0.25), 0 12px 20px rgba(0,0,0,0.4)";
  };

  // Get active box shadow based on variant
  const getActiveBoxShadow = () => {
    if (variant === "flat") {
      return "none";
    }
    return "0 2px 0 rgba(0,0,0,0.2), 0 3px 5px rgba(0,0,0,0.3)";
  };

  // Get hover transform based on variant
  const getHoverTransform = () => {
    if (variant === "flat") {
      return "";
    }
    return "hover:translate-y-[-2px]";
  };

  // Get active transform based on variant
  const getActiveTransform = () => {
    if (variant === "flat") {
      return "";
    }
    return "active:translate-y-[2px] active:border-b-2";
  };

  // Get border bottom color based on variant and hover state
  const getBorderBottomColor = () => {
    if (variant === "flat") {
      return isHovered ? accentColor.hoverValue : accentColor.value;
    }
    return accentColor.value;
  };

  const shadowStyle: CSSProperties & {
    "--nrc-account-shadow": string;
    "--nrc-account-hover-shadow": string;
    "--nrc-account-active-shadow": string;
  } = {
    "--nrc-account-shadow": getBoxShadow(),
    "--nrc-account-hover-shadow": getHoverBoxShadow(),
    "--nrc-account-active-shadow": getActiveBoxShadow(),
  };

  if (!activeAccount) {
    return (
      <button
        type="button"
        ref={assignButtonRef}
        aria-label={t('auth.addAccount')}
        aria-haspopup="menu"
        aria-expanded={expanded}
        aria-controls={expanded ? menuId : undefined}
        className={cn(
          "font-smallcaps relative overflow-hidden backdrop-blur-md transition-all duration-200",
          "rounded-md text-white tracking-wider",
          "flex items-center gap-3 px-4 py-1",
          "text-shadow-sm",
          getBorderClasses(),
          "[box-shadow:var(--nrc-account-shadow)] hover:[box-shadow:var(--nrc-account-hover-shadow)] active:[box-shadow:var(--nrc-account-active-shadow)]",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2",
          "cursor-pointer",
          getHoverTransform(),
          "hover:brightness-110",
          getActiveTransform(),
          "active:brightness-90",
          className,
        )}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          ...shadowStyle,
          backgroundColor: `${accentColor.value}30`,
          borderColor: `${accentColor.value}80`,
          borderBottomColor: getBorderBottomColor(),
          filter: isHovered ? "brightness(1.1)" : "brightness(1)",
        }}
      >
        {variant !== "flat" && (
          <span
            className="absolute inset-x-0 top-0 h-[2px] rounded-t-sm"
            style={{
              backgroundColor: isHovered
                ? accentColor.hoverValue
                : `${accentColor.value}80`,
            }}
          />
        )}

        <span className="absolute inset-0 opacity-0 hover:opacity-30 transition-opacity duration-300 bg-gradient-radial from-white/30 via-transparent to-transparent" />

        <span
          className="relative w-7 h-7 overflow-hidden border-2 rounded-sm flex-shrink-0 flex items-center justify-center"
          style={{
            borderColor: `${accentColor.value}60`,
            backgroundColor: `${accentColor.value}20`,
          }}
        >
          <span className="text-white font-smallcaps text-xs">+</span>
        </span>

        <span className="flex items-center gap-1 min-w-0">
          <span className="text-sm text-white font-smallcaps">
            {t('auth.addAccount')}
          </span>
        </span>

        <Icon
          icon="solar:alt-arrow-down-bold"
          className="w-4 h-4 text-white/90 ml-1 flex-shrink-0"
        />
      </button>
    );
  }

  const username =
    activeAccount.minecraft_username || activeAccount.username || t('auth.unknown');

  return (
    <button
      type="button"
      ref={assignButtonRef}
      aria-label={`${t('auth.minecraftAccounts')}: ${username}`}
      aria-haspopup="menu"
      aria-expanded={expanded}
      aria-controls={expanded ? menuId : undefined}
      className={cn(
        "font-smallcaps relative overflow-hidden backdrop-blur-md transition-all duration-200",
        "rounded-md text-white tracking-wider",
        "flex items-center gap-3 px-4 py-1",
        "text-shadow-sm",
        getBorderClasses(),
        "[box-shadow:var(--nrc-account-shadow)] hover:[box-shadow:var(--nrc-account-hover-shadow)] active:[box-shadow:var(--nrc-account-active-shadow)]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-2",
        "cursor-pointer",
        getHoverTransform(),
        "hover:brightness-110",
        getActiveTransform(),
        "active:brightness-90",
        className,
      )}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        ...shadowStyle,
        backgroundColor: `${accentColor.value}30`,
        borderColor: `${accentColor.value}80`,
        borderBottomColor: getBorderBottomColor(),
        filter: isHovered ? "brightness(1.1)" : "brightness(1)",
      }}
    >
      {variant !== "flat" && (
        <span
          className="absolute inset-x-0 top-0 h-[2px] rounded-t-sm"
          style={{
            backgroundColor: isHovered
              ? accentColor.hoverValue
              : `${accentColor.value}80`,
          }}
        />
      )}

      <span className="absolute inset-0 opacity-0 hover:opacity-30 transition-opacity duration-300 bg-gradient-radial from-white/30 via-transparent to-transparent" />

      <span
        className="relative w-7 h-7 overflow-hidden border-2 rounded-sm flex-shrink-0 flex items-center justify-center"
        style={{
          borderColor: `${accentColor.value}60`,
          backgroundColor: `${accentColor.value}20`,
        }}
      >
        <PlayerHead
          uuid={activeAccount.id}
          username={username}
          size={64}
          fill
          className="text-xs"
        />
      </span>

      {!compact && (
        <span className="flex flex-col min-w-0">
          <span
            className="text-base text-white font-smallcaps truncate"
            title={username}
          >
            {username}
          </span>
        </span>
      )}

      <Icon
        icon="solar:alt-arrow-down-bold"
        className="w-4 h-4 text-white/90 ml-1 flex-shrink-0"
      />
    </button>
  );
});
