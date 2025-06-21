"use client";

import type React from "react";
import { forwardRef, useState } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";
import { 
  getSizeClasses,
  getBorderRadiusClass,
  createRadiusStyle,
  getVariantColors,
  getAccessibilityProps,
  getTextSizeClass,
  type ComponentSize,
  type StateVariant
} from "./design-system";

interface CheckboxProps {
  checked: boolean;
  onChange: (event: { target: { checked: boolean }; currentTarget: { checked: boolean } }) => void;
  disabled?: boolean;
  indeterminate?: boolean;
  size?: ComponentSize;
  label?: string;
  description?: string;
  error?: string;
  state?: StateVariant;
  className?: string;
  required?: boolean;
  id?: string;
  customSize?: string;
  variant?: string;
  onClick?: (e: any) => any;
  title?: string;
}

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(  ({ 
    checked, 
    onChange, 
    disabled = false, 
    indeterminate = false,
    size = "md", 
    label, 
    description, 
    error,
    state,
    className,
    required = false,
    id,
    customSize,
    variant,
    onClick,
    title,
    ...props 
  }, ref) => {
    const [isFocused, setIsFocused] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
      const accentColor = useThemeStore((state) => state.accentColor);
    const isAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
    const borderRadius = useThemeStore((state) => state.borderRadius);    const handleClick = () => {
      if (!disabled) {
        const event = {
          target: { checked: !checked },
          currentTarget: { checked: !checked }
        };
        onChange(event as any);
      }
    };const handleLabelClick = () => {
      if (!disabled) {
        const event = {
          target: { checked: !checked },
          currentTarget: { checked: !checked }
        };
        onChange(event as any);
      }
    };    const handleKeyDown = (e: React.KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && !disabled) {
        e.preventDefault();
        const event = {
          target: { checked: !checked },
          currentTarget: { checked: !checked }
        };
        onChange(event as any);
      }
    };    const effectiveSize = customSize || size;
    const colors = getVariantColors("default", accentColor);
    const radiusClass = getBorderRadiusClass();
    const accessibilityProps = getAccessibilityProps({
      label,
      description,
      error,
      required,
      disabled
    });    const checkboxSizes = {
      xs: "w-5 h-5",
      sm: "w-6 h-6",
      md: "w-7 h-7", 
      lg: "w-8 h-8",
      xl: "w-9 h-9",
    };

    const iconSizes = {
      xs: "w-3 h-3",
      sm: "w-4 h-4",
      md: "w-5 h-5",
      lg: "w-6 h-6", 
      xl: "w-7 h-7",
    };

    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <div className="flex items-center gap-3">          <button
            ref={ref}
            type="button"
            role="checkbox"
            aria-checked={indeterminate ? "mixed" : checked}
            aria-disabled={disabled}
            aria-required={required}
            aria-invalid={!!error}
            aria-describedby={error ? `checkbox-error-${id || ""}` : undefined}
            {...accessibilityProps}            disabled={disabled}
            onClick={onClick || handleClick}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}className={cn(
              "relative flex-shrink-0 flex items-center justify-center backdrop-blur-md",
              "transition-all duration-200 border-2 bg-white/10",
              "focus:outline-none focus:ring-2 focus:ring-white/30",
              radiusClass,
              checkboxSizes[effectiveSize],
              disabled && "opacity-50 cursor-not-allowed",
              !disabled && "cursor-pointer hover:bg-white/20",
              checked || indeterminate ? "bg-opacity-80" : "bg-opacity-30",
            )}            style={{
              borderColor: checked || indeterminate ? colors.main : "rgba(255,255,255,0.3)",
              backgroundColor: checked || indeterminate ? `${colors.main}80` : "rgba(255,255,255,0.1)",
              filter: isHovered && !disabled ? "brightness(1.1)" : "brightness(1)",
              transform: isHovered && !disabled ? "scale(1.05)" : "scale(1)",              ...createRadiusStyle(borderRadius),
            }}
          >
            {(checked || indeterminate) && (
              <Icon
                icon={indeterminate ? "mingcute:minus-line" : "mingcute:check-line"}
                className={cn(
                  "text-white transition-all duration-200",
                  iconSizes[effectiveSize]
                )}
                aria-hidden="true"
              />
            )}
          </button>

          {(label || description) && (
            <div className="flex flex-col gap-1">
              {label && (                <label                  className={cn(
                    "text-white font-minecraft cursor-pointer select-none lowercase",
                    getTextSizeClass((effectiveSize as ComponentSize) || "md", "checkbox"),
                    disabled && "opacity-50 cursor-not-allowed"
                  )}
                  onClick={!disabled ? handleLabelClick : undefined}
                >
                  {label}
                  {required && <span className="text-red-400 ml-1">*</span>}
                </label>
              )}              {description && (
                <span className={cn(
                  "text-white text-opacity-70",
                  getTextSizeClass((effectiveSize === "sm" ? "xs" : "sm") as ComponentSize, "checkbox")
                )}>
                  {description}
                </span>
              )}
            </div>
          )}
        </div>

        {error && (
          <div
            id={`checkbox-error-${id || ""}`}            className={cn(
              "text-red-400 font-minecraft ml-8 lowercase",
              getTextSizeClass("sm", "checkbox")
            )}
            role="alert"
            aria-live="assertive"
          >
            {error}
          </div>
        )}
      </div>
    );
  }
);

Checkbox.displayName = "Checkbox";
