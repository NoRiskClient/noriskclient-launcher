"use client";

import type React from "react";
import { forwardRef, useRef, useState } from "react";
import { cn } from "../../../lib/utils";
import { gsap } from "gsap";
import { useThemeStore } from "../../../store/useThemeStore";
import { ThemedSurface } from "../ThemedSurface";
import { 
  getVariantColors,
  getSizeClasses,
  getBorderRadiusClass,
  getAccessibilityProps,
  type ComponentSize,
  type ComponentVariant 
} from "../design-system";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ComponentVariant;
  displayVariant?: "button" | "ghost" | "themed-surface";
  size?: ComponentSize;
  icon: React.ReactNode;
  shadowDepth?: "default" | "short" | "none";
  label?: string;
  description?: string;
}

interface RippleType {
  x: number;
  y: number;
  size: number;
  id: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      className,
      variant = "default",
      displayVariant = "button",
      size = "md",
      disabled = false,
      icon,
      shadowDepth = "short",
      onClick,
      label,
      description,
      ...props
    },
    ref,
  ) => {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [ripples, setRipples] = useState<RippleType[]>([]);
    const rippleCounter = useRef(0);
    const accentColor = useThemeStore((state) => state.accentColor);
    const isBackgroundAnimationEnabled = useThemeStore(
      (state) => state.isBackgroundAnimationEnabled,
    );
    const [isPressed, setIsPressed] = useState(false);
    const [isHovered, setIsHovered] = useState(false);

    const mergedRef = (node: HTMLButtonElement) => {
      if (ref) {
        if (typeof ref === "function") {
          ref(node);
        } else {
          ref.current = node;
        }
      }
      buttonRef.current = node;
    };

    const handleRipple = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled) return;

      if (onClick) onClick(e);
    };

    const handleMouseDown = () => {
      if (disabled) return;
      setIsPressed(true);
    };

    const handleMouseUp = () => {
      if (disabled) return;
      setIsPressed(false);
    };

    const handleMouseEnter = () => {
      if (disabled) return;
      setIsHovered(true);

      if (
        buttonRef.current &&
        isBackgroundAnimationEnabled &&
        shouldShowShadow()
      ) {
        gsap.to(buttonRef.current, {
          boxShadow: `0 6px 0 rgba(0,0,0,0.25), 0 8px 12px rgba(0,0,0,0.4)`,
          duration: 0.2,
          ease: "power2.out",
        });
      }
    };

    const handleMouseLeave = () => {
      if (disabled) return;
      setIsHovered(false);

      if (
        buttonRef.current &&
        isBackgroundAnimationEnabled &&
        shouldShowShadow()
      ) {
        gsap.to(buttonRef.current, {
          boxShadow: `0 4px 0 rgba(0,0,0,0.3), 0 6px 10px rgba(0,0,0,0.35)`,
          duration: 0.2,
          ease: "power2.out",
        });
      }

      if (isPressed) {
        handleMouseUp();
      }
    };

    const shouldShowShadow = () => {
      return (
        displayVariant === "button" &&
        variant === "3d" &&
        shadowDepth !== "none"
      );
    };    const colors = getVariantColors(variant, accentColor);
    const radiusClass = getBorderRadiusClass();
    const accessibilityProps = getAccessibilityProps({
      label,
      description,
      disabled
    });    const getIconButtonSizeClasses = () => {
      switch (size) {
        case "xs": return "h-[36px] w-[36px] p-2 text-base";
        case "sm": return "h-[42px] w-[42px] p-2.5 text-lg";
        case "md": return "h-[50px] w-[50px] p-3 text-xl";
        case "lg": return "h-[58px] w-[58px] p-3.5 text-2xl";
        case "xl": return "h-[66px] w-[66px] p-4 text-2xl";
        default: return "h-[50px] w-[50px] p-3 text-xl";
      }
    };

    const sizeClasses = getIconButtonSizeClasses();

    const getIconSize = () => {
      switch (size) {
        case "xs": return "w-4 h-4";
        case "sm": return "w-5 h-5";
        case "md": return "w-6 h-6";
        case "lg": return "w-7 h-7";
        case "xl": return "w-8 h-8";
        default: return "w-6 h-6";
      }
    };

    const getBackgroundColor = () => {
      if (displayVariant === "ghost" || displayVariant === "themed-surface")
        return "transparent";

      if (variant === "ghost") {
        return isHovered ? `rgba(255, 255, 255, 0.1)` : "transparent";
      }

      if (variant === "flat" || variant === "flat-secondary") {
        return `${colors.main}30`;
      }

      const baseOpacity = isHovered ? "50" : "30";
      return `${colors.main}${baseOpacity}`;
    };

    const getBorderColor = () => {
      if (displayVariant === "ghost" || displayVariant === "themed-surface")
        return "transparent";

      if (variant === "ghost") {
        return "transparent";
      }

      if (variant === "flat" || variant === "flat-secondary") {
        return `${colors.main}80`;
      }

      return isHovered ? `${colors.light}` : `${colors.main}80`;
    };

    const getBorderBottomColor = () => {
      if (displayVariant === "ghost" || displayVariant === "themed-surface")
        return "transparent";

      if (variant === "ghost") {
        return "transparent";
      }

      if (variant === "flat" || variant === "flat-secondary") {
        return isHovered ? colors.light : colors.dark;
      }

      return isHovered ? colors.light : colors.dark;
    };

    const getBoxShadow = () => {
      if (
        displayVariant === "ghost" ||
        displayVariant === "themed-surface" ||
        variant !== "3d" ||
        shadowDepth === "none"
      ) {
        return "none";
      }

      const part1Y = shadowDepth === "short" ? "4px" : "8px";
      const part2Y = shadowDepth === "short" ? "6px" : "10px";
      const part2Blur = shadowDepth === "short" ? "10px" : "15px";

      return `0 ${part1Y} 0 rgba(0,0,0,0.3), 0 ${part2Y} ${part2Blur} rgba(0,0,0,0.35), inset 0 1px 0 ${colors.light}40, inset 0 0 0 1px ${colors.main}20`;
    };

    const getBorderClasses = () => {
      if (displayVariant === "ghost" || displayVariant === "themed-surface") {
        return "";
      }

      if (variant === "ghost") {
        return "";
      }

      if (variant === "3d") {
        return shadowDepth === "none" ? "border-2" : "border-2 border-b-4";
      }

      return "border border-b-2";
    };

    const getShadowClasses = () => {
      if (
        displayVariant === "ghost" ||
        displayVariant === "themed-surface" ||
        variant !== "3d" ||
        shadowDepth === "none"
      ) {
        return "";
      }

      return shadowDepth === "default"
        ? "shadow-[0_8px_0_rgba(0,0,0,0.3),0_10px_15px_rgba(0,0,0,0.35)]"
        : "shadow-[0_4px_0_rgba(0,0,0,0.3),0_6px_10px_rgba(0,0,0,0.35)]";
    };

    const buttonElement = (
      <button
        ref={mergedRef}
        disabled={disabled}
        onClick={handleRipple}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={cn(
          "font-minecraft relative overflow-hidden backdrop-blur-md",
          "rounded-md text-white tracking-wider",
          "flex items-center justify-center",
          "text-shadow-sm",
          getBorderClasses(),
          getShadowClasses(),
          "focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-1 focus:ring-offset-black/20",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          displayVariant !== "themed-surface" && sizeClasses,
          className,
        )}
        style={{
          backgroundColor: getBackgroundColor(),
          borderColor: getBorderColor(),
          borderBottomColor: getBorderBottomColor(),
          boxShadow: getBoxShadow(),
          color: colors.text,
          filter: isHovered && !disabled ? "brightness(1.1)" : "brightness(1)",
        }}
        {...props}
      >
        {variant !== "ghost" &&
          variant === "3d" &&
          displayVariant !== "ghost" &&
          displayVariant !== "themed-surface" && (
            <span
              className="absolute inset-x-0 top-0 h-[2px] rounded-t-sm transition-colors duration-200"
              style={{
                backgroundColor: isHovered
                  ? `${colors.light}`
                  : `${colors.light}80`,
                opacity: isHovered ? 1 : 0.8,
              }}
            />
          )}        <span
          className={cn(
            "relative z-10 flex items-center justify-center transition-transform duration-200",
            getIconSize(),
          )}
          style={{
            transform: isHovered && !disabled ? "scale(1.05)" : "scale(1)",
          }}
          aria-hidden="true"
        >
          {icon}
        </span>
      </button>
    );

    if (displayVariant === "themed-surface") {
      const surfaceBaseColorHex =
        variant === "default" || variant === "ghost" ? undefined : colors.main;      return (
        <ThemedSurface
          baseColorHex={surfaceBaseColorHex}
          className={cn(sizeClasses, "!p-0", className)}
        >
          {buttonElement}
        </ThemedSurface>
      );
    }

    return buttonElement;
  },
);

IconButton.displayName = "IconButton";
