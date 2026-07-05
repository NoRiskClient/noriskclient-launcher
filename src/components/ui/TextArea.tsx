"use client";

import type React from "react";
import { forwardRef, useState } from "react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";
import { 
  getSizeClasses,
  getVariantColors,
  getAccessibilityProps,
  getRadiusClasses,
  createRadiusStyle,
  type ComponentVariant,
  type ComponentSize,
  type StateVariant
} from "./design-system";

export interface TextAreaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  success?: boolean;
  helperText?: string;
  variant?: ComponentVariant;
  state?: StateVariant;
  resize?: "none" | "vertical" | "horizontal" | "both";
  fullWidth?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  (
    {
      className,
      error,
      success,
      helperText,
      variant = "default",
      state,
      resize = "vertical",
      fullWidth = true,
      rows = 4,
      ...props
    },
    ref,
  ) => {
    const [isFocused, setIsFocused] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
      const accentColor = useThemeStore((state) => state.accentColor);
    const isAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
    const borderRadius = useThemeStore((state) => state.borderRadius);

    const handleFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
      if (props.disabled) return;
      setIsFocused(true);
      if (props.onFocus) props.onFocus(e);
    };

    const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
      if (props.disabled) return;
      setIsFocused(false);
      if (props.onBlur) props.onBlur(e);
    };

    const handleMouseEnter = () => {
      if (props.disabled) return;
      setIsHovered(true);
    };

    const handleMouseLeave = () => {
      if (props.disabled) return;
      setIsHovered(false);
    };    const currentState = error ? "error" : (success ? "success" : state);
    const colors = getVariantColors(variant || "default", accentColor);
    const accessibilityProps = getAccessibilityProps({
      label: props["aria-label"],
      description: helperText,
      error: error,
      disabled: props.disabled
    });

    const resizeClasses = {
      none: "resize-none",
      vertical: "resize-y",
      horizontal: "resize-x", 
      both: "resize",
    };

    return (
      <div className={cn("w-full", !fullWidth && "w-auto")}>
        <div
          className={cn(
            "relative overflow-hidden min-h-[100px] border-2 border-b-4 backdrop-blur-md",
            getRadiusClasses(borderRadius, "input"),
            props.disabled && "opacity-50 cursor-not-allowed",
            className,
          )}          style={{
            backgroundColor: isFocused || isHovered ? `${colors.main}50` : `${colors.main}30`,
            borderColor: error ? "rgba(239, 68, 68, 0.6)" : `${colors.main}${isFocused || isHovered ? "90" : "80"}`,
            borderBottomColor: error ? "rgb(185, 28, 28)" : (isFocused || isHovered ? colors.light : colors.main),
            filter: (isFocused || isHovered) && !props.disabled ? "brightness(1.1)" : "brightness(1)",
            transform: isHovered && !props.disabled ? "scale(1.02)" : "scale(1)",
            ...createRadiusStyle(borderRadius),
          }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <textarea
            ref={ref}
            rows={rows}            className={cn(
              "w-full h-full bg-transparent outline-none",
              "text-white placeholder-white placeholder-opacity-50",
              "font-minecraft lowercase p-4 text-xl",
              "focus:outline-none",
              resizeClasses[resize],
            )}onFocus={handleFocus}
            onBlur={handleBlur}
            aria-invalid={!!error}
            aria-describedby={
              error || helperText ? `${props.id || "textarea"}-description` : undefined
            }
            {...accessibilityProps}
            {...props}
          />
        </div>

        {(error || helperText) && (
          <div
            id={`${props.id || "textarea"}-description`}
            className={cn(
              "mt-2 text-sm lowercase",
              error ? "text-red-400" : "text-white text-opacity-70"
            )}
            role={error ? "alert" : "region"}
            aria-live={error ? "assertive" : "polite"}
          >
            {error || helperText}
          </div>
        )}
      </div>
    );
  },
);

TextArea.displayName = "TextArea";
