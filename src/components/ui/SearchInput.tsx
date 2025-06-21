"use client";

import type React from "react";
import { forwardRef, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";
import { gsap } from "gsap";
import { ThemedSurface } from "./ThemedSurface";
import { 
  getSizeClasses,
  getBorderRadiusClass,
  getAccessibilityProps,
  type ComponentSize,
  type ComponentVariant 
} from "./design-system";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onSearch?: (searchTerm: string) => void;
  loading?: boolean;
  disabled?: boolean;
  size?: ComponentSize;
  variant?: ComponentVariant | "minimal" | "filled" | "themed-surface";
  label?: string;
  description?: string;
  error?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      value,
      onChange,
      placeholder = "search...",
      className,
      onSearch,
      loading = false,
      disabled = false,
      size = "md",
      variant = "default",
      label,
      description,
      error,
    },
    ref,
  ) => {
    const [isFocused, setIsFocused] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [isPressed, setIsPressed] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const accentColor = useThemeStore((state) => state.accentColor);
    const isBackgroundAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
    const sizeClasses = getSizeClasses(size, "input");
    const radiusClass = getBorderRadiusClass();
    const accessibilityProps = getAccessibilityProps({
      label,
      description,
      error,
      disabled
    });    const mergedRef = (node: HTMLInputElement) => {
      if (ref) {
        if (typeof ref === "function") {
          ref(node);
        } else {
          ref.current = node;
        }
      }
      inputRef.current = node;
    };

    const handleFocus = () => {
      if (disabled) return;
      setIsFocused(true);
    };

    const handleBlur = () => {
      if (disabled) return;
      setIsFocused(false);
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
        containerRef.current &&
        isBackgroundAnimationEnabled &&
        variant === "3d"
      ) {
        gsap.to(containerRef.current, {
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
        containerRef.current &&
        isBackgroundAnimationEnabled &&
        variant === "3d"
      ) {
        gsap.to(containerRef.current, {
          boxShadow: `0 4px 0 rgba(0,0,0,0.3), 0 6px 10px rgba(0,0,0,0.35)`,
          duration: 0.2,
          ease: "power2.out",
        });
      }

      if (isPressed) {
        handleMouseUp();
      }
    };

    const handleClear = () => {
      if (disabled) return;
      onChange("");
      if (onSearch) {
        onSearch("");
      }
      if (inputRef.current) {
        inputRef.current.focus();
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && onSearch) {
        onSearch(value);
      }
    };    const sizeStyles = {
      sm: {
        container: "h-[42px]",
        padding: "py-2 px-6",
        text: "text-xl",
        icon: "w-5 h-5",
      },
      md: {
        container: "h-[50px]",
        padding: "py-2.5 px-8",
        text: "text-2xl",
        icon: "w-6 h-6",
      },
      lg: {
        container: "h-[58px]",
        padding: "py-3 px-10",
        text: "text-3xl",
        icon: "w-7 h-7",
      },
    };    const getVariantColors = () => {
      return {
        main: accentColor.value,
        light: accentColor.hoverValue,
        dark: accentColor.value,
        text: "#ffffff",
      };
    };

    const colors = getVariantColors();    const getBackgroundColor = () => {
      if (variant === "minimal") {
        return "transparent";
      }

      const baseOpacity = isHovered || isFocused ? "50" : "30";
      return `${colors.main}${baseOpacity}`;
    };    const getBorderColor = () => {
      if (variant === "minimal") return "transparent";

      return isHovered || isFocused ? `${colors.light}` : `${colors.main}80`;
    };

    const getBorderClasses = () => {
      if (variant === "minimal")
        return "border-b-2 border-white/30 rounded-none";
      if (variant === "filled") return "border-none rounded-[var(--border-radius)]";
      if (variant === "3d") return "border-2 border-b-4 rounded-[var(--border-radius)]";
      return "border border-b-2 rounded-[var(--border-radius)]";
    };    const getBoxShadow = () => {
      if (variant === "minimal" || variant === "filled" || variant !== "3d")
        return "none";

      return isHovered || isFocused
        ? `0 6px 0 rgba(0,0,0,0.25), 0 8px 12px rgba(0,0,0,0.4), inset 0 1px 0 ${colors.light}40, inset 0 0 0 1px ${colors.main}20`
        : `0 4px 0 rgba(0,0,0,0.3), 0 6px 10px rgba(0,0,0,0.35), inset 0 1px 0 ${colors.light}40, inset 0 0 0 1px ${colors.main}20`;
    };    const standardInputContent = (
      <>
        {variant === "3d" && (
          <span
            className="absolute inset-x-0 top-0 h-[2px] rounded-t-sm transition-colors duration-200"
            style={{
              backgroundColor:
                isHovered || isFocused
                  ? `${colors.light}`
                  : `${colors.light}80`,
              opacity: isHovered || isFocused ? 1 : 0.8,
            }}
          />
        )}

        <div className="flex items-center justify-center w-full h-full gap-2">
          <div
            className={cn(
              "flex items-center justify-center transition-transform duration-200",
              sizeStyles[size].icon,
            )}
            style={{
              transform: isHovered && !disabled ? "scale(1.05)" : "scale(1)",
            }}
          >
            {loading ? (
              <Icon
                icon="solar:refresh-bold"
                className="animate-spin text-white"
              />
            ) : (
              <Icon icon="solar:magnifer-bold" className="text-white" />
            )}
          </div>

          <input
            ref={mergedRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(
              "flex-1 h-full bg-transparent border-none outline-none text-white font-minecraft placeholder:text-white/50 lowercase truncate",
              sizeStyles[size].text,
            )}
            onFocus={handleFocus}
            onBlur={handleBlur}
            spellCheck={false}
            autoComplete="off"
          />

          {value && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className={cn(
                "flex items-center justify-center transition-transform duration-200",
                "text-white/70 hover:text-white",
                sizeStyles[size].icon,
              )}
              style={{
                transform: isHovered && !disabled ? "scale(1.05)" : "scale(1)",
              }}
              aria-label="Clear search"
            >
              <Icon icon="lucide:x" />
            </button>
          )}
        </div>
      </>    );

    if (variant === "themed-surface") {
      return (
        <ThemedSurface className={cn("w-full", className)}>
          <div
            className={cn(
              "flex items-center w-full h-full",
              sizeStyles[size].container,
              "w-full",
            )}
            onClick={() => inputRef.current?.focus()}
          >
            <div className="flex items-center justify-between w-full h-full px-4">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex items-center justify-center flex-shrink-0",
                    sizeStyles[size].icon,
                  )}
                >
                  {loading ? (
                    <Icon
                      icon="solar:refresh-bold"
                      className="animate-spin text-white"
                    />
                  ) : (
                    <Icon icon="solar:magnifer-bold" className="text-white" />
                  )}
                </div>

                <input
                  ref={mergedRef}
                  type="text"
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholder}
                  disabled={disabled}
                  className={cn(
                    "bg-transparent border-none outline-none text-white font-minecraft placeholder:text-white/50 lowercase truncate",
                    sizeStyles[size].text,
                  )}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>

              {value && !disabled && (
                <button
                  type="button"
                  onClick={handleClear}
                  className={cn(
                    "flex items-center justify-center flex-shrink-0",
                    "text-white/70 hover:text-white transition-colors duration-200",
                    sizeStyles[size].icon,
                  )}
                  aria-label="Clear search"
                >
                  <Icon icon="lucide:x" />
                </button>
              )}
            </div>
          </div>
        </ThemedSurface>
      );
    }    return (
      <div
        ref={containerRef}
        className={cn(
          "font-minecraft relative overflow-hidden backdrop-blur-md",
          "text-white tracking-wider lowercase",
          "flex items-center justify-center w-full",
          "text-shadow-sm",
          getBorderClasses(),
          "focus-within:outline-none focus-within:ring-2 focus-within:ring-white/30 focus-within:ring-offset-1 focus-within:ring-offset-black/20",
          disabled && "opacity-50 cursor-not-allowed",
          sizeStyles[size].container,
          sizeStyles[size].padding,
          className,
        )}
        style={{
          backgroundColor: getBackgroundColor(),
          borderColor: getBorderColor(),
          borderBottomColor:
            variant === "minimal"
              ? "transparent"
              : isHovered || isFocused
                ? colors.light
                : colors.dark,
          boxShadow: getBoxShadow(),
          filter:
            (isHovered || isFocused) && !disabled
              ? "brightness(1.1)"
              : "brightness(1)",
        }}
        onClick={() => inputRef.current?.focus()}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {standardInputContent}
      </div>
    );
  },
);

SearchInput.displayName = "SearchInput";
