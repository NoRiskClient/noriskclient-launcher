"use client";

import type React from "react";
import { forwardRef, useRef, useState } from "react";
import { cn } from "../../../lib/utils";
import { gsap } from "gsap";
import { useThemeStore } from "../../../store/useThemeStore";
import { 
  getVariantColors,
  getSizeClasses,
  getBorderRadiusClass,
  getAccessibilityProps,
  createRadiusStyle,
  type ComponentSize,
  type ComponentVariant
} from "../design-system";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ComponentVariant;
  size?: ComponentSize;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  shadowDepth?: "default" | "short" | "none";
  widthClassName?: string;
  heightClassName?: string;
  label?: string;
  description?: string;
}

interface RippleType {
  x: number;
  y: number;
  size: number;
  id: number;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className,
      variant = "default",
      size = "md",
      disabled = false,
      icon,
      iconPosition = "left",
      shadowDepth = "short",
      onClick,
      widthClassName,
      heightClassName,
      label,
      description,
      ...props
    },
    ref,
  ) => {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const accentColor = useThemeStore((state) => state.accentColor);
    const borderRadius = useThemeStore((state) => state.borderRadius);
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
      return variant === "3d" && shadowDepth !== "none";
    };    const colors = getVariantColors(variant, accentColor);
    
    const getButtonSizeClasses = () => {
      switch (size) {
        case "xs": return "h-[36px] px-5 py-2 text-xl";
        case "sm": return "h-[42px] px-6 py-2 text-2xl"; 
        case "md": return "h-[50px] px-8 py-2.5 text-2xl";
        case "lg": return "h-[58px] px-10 py-3 text-3xl";
        case "xl": return "h-[66px] px-12 py-4 text-3xl";
        default: return "h-[50px] px-8 py-2.5 text-2xl";
      }
    };
    
    const sizeClasses = getButtonSizeClasses();
    const radiusClass = getBorderRadiusClass(borderRadius);
    const accessibilityProps = getAccessibilityProps({
      label,
      description,
      disabled
    });    const getBackgroundColor = () => {
      if (variant === "ghost") {
        return isHovered ? `rgba(255, 255, 255, 0.1)` : "transparent";
      }

      if (variant === "flat" || variant === "flat-secondary") {
        return `${colors.main}30`;
      }

      const baseOpacity = isHovered ? "50" : "30";
      return `${colors.main}${baseOpacity}`;
    };    const getBorderColor = () => {
      if (variant === "ghost") {
        return "transparent";
      }

      if (variant === "flat" || variant === "flat-secondary") {
        return `${colors.main}80`;
      }

      return isHovered ? colors.light : `${colors.main}80`;
    };

    const getBorderBottomColor = () => {
      if (variant === "ghost") {
        return "transparent";
      }

      if (variant === "flat" || variant === "flat-secondary") {
        return isHovered ? colors.light : colors.dark;
      }

      return isHovered ? colors.light : colors.dark;
    };

    const getBoxShadow = () => {
      if (variant !== "3d" || shadowDepth === "none") {
        return "none";
      }

      const part1Y = shadowDepth === "short" ? "4px" : "8px";
      const part2Y = shadowDepth === "short" ? "6px" : "10px";
      const part2Blur = shadowDepth === "short" ? "10px" : "15px";

      return `0 ${part1Y} 0 rgba(0,0,0,0.3), 0 ${part2Y} ${part2Blur} rgba(0,0,0,0.35), inset 0 1px 0 ${colors.light}40, inset 0 0 0 1px ${colors.main}20`;
    };

    const getBorderClasses = () => {
      if (variant === "ghost") {
        return "";
      }

      if (variant === "3d") {
        return shadowDepth === "none" ? "border-2" : "border-2 border-b-4";
      }

      return "border border-b-2";
    };

    const getTextColor = () => {
      if (variant === "ghost") {
        return "#ffffff";
      }

      return colors.text;
    };

    return (
      <button
        ref={mergedRef}
        type="button"
        disabled={disabled}        className={cn(
          "relative overflow-hidden lowercase font-minecraft transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2",
          "flex items-center justify-center gap-2 backdrop-blur-md",
          radiusClass,
          sizeClasses,
          getBorderClasses(),
          disabled && "opacity-50 cursor-not-allowed",
          widthClassName,
          heightClassName,
          className,
        )}
        style={{
          backgroundColor: getBackgroundColor(),
          borderColor: getBorderColor(),
          borderBottomColor: getBorderBottomColor(),
          boxShadow: getBoxShadow(),
          color: getTextColor(),
          transform: isPressed ? "translateY(1px)" : "translateY(0)",
          filter: isHovered && !disabled ? "brightness(1.1)" : "brightness(1)",
          ...createRadiusStyle(borderRadius),
        }}
        onClick={handleRipple}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...accessibilityProps}
        {...props}      >        {icon && iconPosition === "left" && (
          <span className="flex items-center transition-transform duration-200" style={{
            transform: isHovered && !disabled ? "scale(1.05)" : "scale(1)",
          }}>{icon}</span>
        )}
        <span className="transition-transform duration-200" style={{
          transform: isHovered && !disabled ? "scale(1.05)" : "scale(1)",
        }}>
          {children}
        </span>
        {icon && iconPosition === "right" && (
          <span className="flex items-center transition-transform duration-200" style={{
            transform: isHovered && !disabled ? "scale(1.05)" : "scale(1)",
          }}>{icon}</span>
        )}
      </button>
    );
  },
);

Button.displayName = "Button";
