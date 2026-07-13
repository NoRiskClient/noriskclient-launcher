"use client";

import type React from "react";
import { forwardRef, useRef, useState } from "react";
import { useThemeStore } from "../../store/useThemeStore";
import { cn } from "../../lib/utils";
import { ThemedSurface } from "./ThemedSurface";
import { 
  getVariantColors, 
  getSizeClasses,
  getBorderRadiusClass,
  getAccessibilityProps,
  getTextSizeClass,
  type ComponentSize,
  type ComponentVariant 
} from "./design-system";

export interface TagBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  iconElement?: React.ReactNode;
  variant?: ComponentVariant | "inactive" | "flat" | "filter";
  size?: ComponentSize;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
}

export const TagBadge = forwardRef<HTMLElement, TagBadgeProps>(
  (
    {
      children,
      className,
      iconElement,
      variant = "default",
      size = "md",
      onClick,
      disabled = false,
      label,
      description,
      ...props
    },
    ref,
  ) => {
    const badgeRef = useRef<HTMLElement>(null);
    const accentColor = useThemeStore((state) => state.accentColor);
    const isBackgroundAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
    const [isHovered, setIsHovered] = useState(false);
    const [isPressed, setIsPressed] = useState(false);
    const isClickable = !!onClick && !disabled;

    const mergedRef = (node: HTMLElement) => {
      if (ref) {
        if (typeof ref === "function") {
          ref(node);
        } else {
          ref.current = node;
        }
      }
      badgeRef.current = node;
    };

    const handleMouseDown = () => {
      if (disabled || !isClickable) return;
      setIsPressed(true);
    };

    const handleMouseUp = () => {
      if (disabled || !isClickable) return;
      setIsPressed(false);
    };

    const handleMouseEnter = () => {
      if (disabled || !isClickable) return;
      setIsHovered(true);
    };

    const handleMouseLeave = () => {
      if (disabled || !isClickable) return;
      setIsHovered(false);
      if (isPressed) {
        handleMouseUp();
      }
    };

    const getVariantStyles = () => {
      if (variant === "inactive") {
        return {
          main: "#6b7280",
          light: "#9ca3af",
          dark: "#4b5563",
          text: "#f3f4f6",
        };
      }
      if (variant === "filter") {
        return {
          main: accentColor.value,
          light: accentColor.value,
          dark: accentColor.value,
          text: "#ffffff",
        };
      }
      return getVariantColors(variant as ComponentVariant, accentColor);
    };    const getSizeClasses = () => {
      switch (size) {
        case "sm":
          return "px-1.5 py-0.5 rounded-sm min-h-[12px]";
        case "lg":
          return "px-3 py-1 rounded-md min-h-[28px]";
        case "xl":
          return "px-4 py-1.5 rounded-md min-h-[36px]";
        default:
          return "px-1.5 py-0.5 rounded-sm min-h-[12px]";
      }
    };    const variantStyles = getVariantStyles();
    const sizeClasses = getSizeClasses();
    const accessibilityProps = getAccessibilityProps({
      label: label || (typeof children === "string" ? children : undefined),
      description,
      disabled
    });
    const getTextSizeClass = () => {
      switch (size) {
        case "sm":
          return "text-[0.75em]";
        case "lg":
          return "text-base";
        case "xl":
          return "text-lg";
        default:
          return "text-[0.7em]";
      }
    };

    const customStyling =
      variant === "flat"
        ? {
            backgroundColor: `${variantStyles.main}20`,
            boxShadow: "none",
          }
        : variant === "destructive"
        ? {
            backgroundColor: "#dc262620",
            borderWidth: "1px",
            borderStyle: "solid",
            borderColor: "#dc262680",
            color: "#ffffff",
          }
        : {};    const { 
      onCopy, 
      onCut, 
      onPaste, 
      onCompositionEnd, 
      onCompositionStart, 
      onCompositionUpdate, 
      ...cleanProps 
    } = props;

    const baseProps = {
      ref: mergedRef,
      className: cn(
        "inline-flex items-center justify-center relative overflow-hidden", "w-fit font-smallcaps transition-all duration-200",
        sizeClasses,
        isClickable ? "cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-1 focus:ring-offset-black/20" : "",
        disabled ? "opacity-50 cursor-not-allowed" : "",
        className,
      ),
      style: {
        backgroundColor: variant === "filter" ? `${variantStyles.main}30` : variant === "destructive" ? undefined : `${variantStyles.main}15`,
        borderWidth: variant === "filter" ? "1px" : variant === "destructive" ? undefined : "0px",
        borderStyle: variant === "filter" ? "solid" : variant === "destructive" ? undefined : "none",
        borderColor: variant === "filter" ? `${variantStyles.main}80` : variant === "destructive" ? undefined : "transparent",
        color: variant === "filter" ? variantStyles.text : variant === "destructive" ? undefined : "#a1a1aa", // text-zinc-400
        filter: isHovered && isClickable && !disabled ? "brightness(1.1)" : "brightness(1)",
        ...customStyling
      },
      ...accessibilityProps
    };

    const content = (
      <>        <span          className={cn(
            "relative z-10 flex items-center font-minecraft",
            iconElement ? "gap-x-1.5" : "",
            getTextSizeClass(),
          )}
          style={{
            letterSpacing: "0.01em",
            textTransform: "capitalize",
          }}
        >
          {iconElement && (
            <span className="flex-shrink-0 w-2.5 h-2.5 flex items-center justify-center" aria-hidden="true">
              {iconElement}
            </span>
          )}
          {children}
        </span>
        {description && (
          <span 
            id={accessibilityProps["aria-describedby"]}
            className="sr-only"
          >
            {description}
          </span>
        )}
      </>
    );    if (isClickable) {
      return (
        <button
          {...baseProps}
          type="button"
          onClick={onClick}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {content}
        </button>
      );
    }

    return (
      <span {...baseProps} {...cleanProps}>
        {content}
      </span>
    );
  },
);

TagBadge.displayName = "TagBadge";
