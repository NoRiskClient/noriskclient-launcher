"use client";

import type React from "react";
import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";
import { getRadiusClasses, createRadiusStyle } from "./design-system";
import { Dropdown } from "./dropdown/Dropdown.tsx";
import { DropdownItem } from "./dropdown/DropdownItem.tsx";
import { gsap } from "gsap";
import { ThemedSurface } from "./ThemedSurface";

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "themed-surface" | "flat" | "3d";
}

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  className,
  disabled = false,
  size = "md",
  variant = "default",
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);  const accentColor = useThemeStore((state) => state.accentColor);
  const borderRadius = useThemeStore((state) => state.borderRadius);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const shouldAnimate =
    isBackgroundAnimationEnabled && variant !== "themed-surface";

  const selectedOption = options.find((option) => option.value === value);

  const handleClick = () => {
    if (disabled) return;
    setIsOpen(!isOpen);
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

    if (triggerRef.current && shouldAnimate && variant === "3d") {
      gsap.to(triggerRef.current, {
        boxShadow: `0 6px 0 rgba(0,0,0,0.25), 0 8px 12px rgba(0,0,0,0.4)`,
        duration: 0.2,
        ease: "power2.out",
      });
    }
  };

  const handleMouseLeave = () => {
    if (disabled) return;
    setIsHovered(false);
    if (isPressed) handleMouseUp();

    if (triggerRef.current && shouldAnimate && variant === "3d") {
      gsap.to(triggerRef.current, {
        boxShadow: `0 4px 0 rgba(0,0,0,0.3), 0 6px 10px rgba(0,0,0,0.35)`,
        duration: 0.2,
        ease: "power2.out",
      });
    }
  };

  const handleOptionSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };  const sizeStyles = {
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
  };

  const getVariantColors = () => {
    return {
      main: accentColor.value,
      light: accentColor.hoverValue,
      dark: accentColor.value,
      text: "#ffffff",
    };
  };

  const colors = getVariantColors();

  const getBackgroundColor = () => {
    const baseOpacity = isHovered || isOpen ? "50" : "30";
    return `${colors.main}${baseOpacity}`;
  };

  const getBorderColor = () => {
    return isHovered || isOpen ? `${colors.light}` : `${colors.main}80`;
  };
  const getBorderClasses = () => {
    if (variant === "3d") return "border-2 border-b-4";
    return "border border-b-2";
  };

  const getBoxShadow = () => {
    if (variant !== "3d") return "none";

    return isHovered || isOpen
      ? `0 6px 0 rgba(0,0,0,0.25), 0 8px 12px rgba(0,0,0,0.4), inset 0 1px 0 ${colors.light}40, inset 0 0 0 1px ${colors.main}20`
      : `0 4px 0 rgba(0,0,0,0.3), 0 6px 10px rgba(0,0,0,0.35), inset 0 1px 0 ${colors.light}40, inset 0 0 0 1px ${colors.main}20`;
  };

  const buttonContent = (
    <>
      <div
        className="flex items-center gap-2 truncate transition-transform duration-200"
        style={{
          transform: isHovered && !disabled ? "scale(1.05)" : "scale(1)",
        }}
      >
        {selectedOption?.icon && (
          <span className="flex-shrink-0">{selectedOption.icon}</span>
        )}
        <span className="truncate">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
      </div>
      <Icon
        icon="solar:alt-arrow-down-bold"
        className={cn(
          "w-5 h-5 transition-transform duration-200 flex-shrink-0",
          isOpen && "transform rotate-180",
        )}
      />
    </>
  );

  if (variant === "themed-surface") {
    return (
      <ThemedSurface
        className={cn("relative w-full", className)}
        aria-disabled={disabled}
      >
        <div
          ref={containerRef}
          onClick={disabled ? undefined : handleClick}
          className={cn(
            "w-full h-full flex items-center justify-between",
            disabled ? "cursor-not-allowed" : "cursor-pointer",
            "font-minecraft lowercase text-white",
            sizeStyles[size].container,
            sizeStyles[size].padding,
            sizeStyles[size].text,
          )}
          onMouseEnter={() => !disabled && setIsHovered(true)}
          onMouseLeave={() => !disabled && setIsHovered(false)}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          {buttonContent}
        </div>
        <Dropdown
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          triggerRef={triggerRef}
          width={triggerRef.current?.offsetWidth || 300}
          position={options.length > 6 ? "top" : "bottom"}
        >
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {options.map((option) => (
              <DropdownItem
                key={option.value}
                isActive={option.value === value}
                icon={option.icon}
                onClick={() => handleOptionSelect(option.value)}
              >
                {option.label}
              </DropdownItem>
            ))}
          </div>
        </Dropdown>
      </ThemedSurface>
    );
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}        className={cn(
          "font-minecraft relative overflow-hidden backdrop-blur-md",
          "text-white tracking-wider lowercase",
          "flex items-center justify-between w-full",
          "text-shadow-sm",
          getBorderClasses(),
          getRadiusClasses(borderRadius, "input"),
          "focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-1 focus:ring-offset-black/20",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
          sizeStyles[size].container,
          sizeStyles[size].padding,
          sizeStyles[size].text,
          className,
        )}        style={{
          backgroundColor: getBackgroundColor(),
          borderColor: getBorderColor(),
          borderBottomColor: isHovered || isOpen ? colors.light : colors.dark,
          boxShadow: getBoxShadow(),
          filter:
            (isHovered || isOpen) && !disabled
              ? "brightness(1.1)"
              : "brightness(1)",
          ...createRadiusStyle(borderRadius),
        }}
        disabled={disabled}
      >        {variant === "3d" && (
          <span
            className="absolute inset-x-0 top-0 h-[2px] transition-colors duration-200"
            style={{
              backgroundColor:
                isHovered || isOpen ? `${colors.light}` : `${colors.light}80`,
              opacity: isHovered || isOpen ? 1 : 0.8,              borderTopLeftRadius: borderRadius === 0 ? "0" : `${borderRadius}px`,
              borderTopRightRadius: borderRadius === 0 ? "0" : `${borderRadius}px`,
            }}
          />
        )}

        {buttonContent}
      </button>

      <Dropdown
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        triggerRef={triggerRef}
        width={triggerRef.current?.offsetWidth || 300}
        position={options.length > 6 ? "top" : "bottom"}
      >
        <div className="max-h-60 overflow-y-auto custom-scrollbar">
          {options.map((option) => (
            <DropdownItem
              key={option.value}
              isActive={option.value === value}
              icon={option.icon}
              onClick={() => handleOptionSelect(option.value)}
            >
              {option.label}
            </DropdownItem>
          ))}
        </div>
      </Dropdown>
    </div>
  );
}
