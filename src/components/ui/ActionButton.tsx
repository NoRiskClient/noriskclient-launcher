"use client";

import React from "react";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";

export type ActionButtonVariant = "primary" | "secondary" | "icon-only" | "destructive" | "text" | "highlight";

export interface ActionButtonProps {
  /** Unique identifier for the button */
  id?: string;
  /** Label text to display */
  label?: string;
  /** Icon to display */
  icon: string;
  /** Button variant/style */
  variant?: ActionButtonVariant;
  /** Optional tooltip text */
  tooltip?: string;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Click handler */
  onClick?: (e: React.MouseEvent) => void;
  /** Custom size override */
  size?: "sm" | "md" | "lg";
  /** Additional CSS classes for the icon */
  iconClassName?: string;
}

export function ActionButton({
  id,
  label,
  icon,
  variant = "secondary",
  tooltip,
  disabled = false,
  className = "",
  onClick,
  size = "md",
  iconClassName = "",
}: ActionButtonProps) {
  const accentColor = useThemeStore((state) => state.accentColor);

  // Auto-detect icon-only if no label is provided (but preserve special variants)
  const effectiveVariant = !label && variant !== "icon-only" && variant !== "highlight" && variant !== "text" ? "icon-only" : variant;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled && onClick) {
      onClick(e);
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case "sm":
        return effectiveVariant === "icon-only"
          ? "py-1.5 px-1.5 text-sm"
          : "px-2 py-0.5 text-base";
      case "lg":
        return effectiveVariant === "icon-only"
          ? "py-[0.57rem] px-[0.57rem] text-lg"
          : "px-4 py-1.5 text-lg";
      default: // md
        return effectiveVariant === "icon-only"
          ? "py-[0.57rem] px-[0.57rem] text-base"
          : "px-3 py-1 text-base";
    }
  };

  const getIconSize = () => {
    switch (size) {
      case "sm":
        return effectiveVariant === "icon-only" ? "w-4 h-4" : "w-3 h-3";
      case "lg":
        return effectiveVariant === "icon-only" ? "w-6 h-6" : "w-5 h-5";
      default: // md
        return effectiveVariant === "icon-only" ? "w-5 h-5" : "w-4 h-4";
    }
  };

  const getButtonStyles = () => {
    const baseClasses = (effectiveVariant === "text" || effectiveVariant === "highlight")
      ? `transition-all duration-200 font-smallcaps flex items-center gap-2 ${getSizeClasses()}`
      : `transition-all duration-200 hover:scale-105 border font-smallcaps rounded-lg flex items-center gap-2 ${getSizeClasses()}`;
    
    switch (effectiveVariant) {
      case "primary":
        return {
          className: `${baseClasses} text-white`,
          style: {
            backgroundColor: `${accentColor.value}20`,
            borderColor: `${accentColor.borderValue || accentColor.textValue || accentColor.value}60`,
            color: 'white',
          },
          onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
            if (!disabled) {
              e.currentTarget.style.backgroundColor = `${accentColor.value}30`;
              e.currentTarget.style.borderColor = `${accentColor.borderValue || accentColor.textValue || accentColor.value}80`;
            }
          },
          onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
            if (!disabled) {
              e.currentTarget.style.backgroundColor = `${accentColor.value}20`;
              e.currentTarget.style.borderColor = `${accentColor.borderValue || accentColor.textValue || accentColor.value}60`;
            }
          },
        };
      
      case "secondary":
        return {
          className: `${baseClasses} bg-black/30 hover:bg-black/40 text-white/70 hover:text-white border-white/10 hover:border-white/20`,
          style: {},
        };
      
      case "icon-only":
        return {
          className: `${baseClasses} bg-black/30 hover:bg-black/40 text-white/70 hover:text-white justify-center border-white/10 hover:border-white/20`,
          style: {},
        };
      
      case "destructive":
        return {
          className: `${baseClasses} bg-red-600/20 hover:bg-red-600/30 text-white hover:text-white border-red-500/30 hover:border-red-500/50`,
          style: {},
        };
      
      case "text":
        return {
          className: `${baseClasses} text-white/60 hover:text-white cursor-pointer`,
          style: {
            backgroundColor: 'transparent',
            border: 'none',
          },
          onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
            if (!disabled) {
              e.currentTarget.style.backgroundColor = `${accentColor.value}10`;
              e.currentTarget.style.color = 'white';
            }
          },
          onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
            if (!disabled) {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
            }
          },
        };
      
      case "highlight":
        return {
          className: `${baseClasses} cursor-pointer`,
          style: {
            backgroundColor: 'transparent',
            border: 'none',
            color: accentColor.textValue || accentColor.value,
          },
          onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
            if (!disabled) {
              e.currentTarget.style.backgroundColor = `${accentColor.value}20`;
              e.currentTarget.style.color = accentColor.textValue || accentColor.value;
              e.currentTarget.style.textShadow = `0 0 8px ${accentColor.textValue || accentColor.value}40`;
            }
          },
          onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
            if (!disabled) {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = accentColor.textValue || accentColor.value;
              e.currentTarget.style.textShadow = 'none';
            }
          },
        };
      
      default:
        return {
          className: `${baseClasses} bg-black/30 hover:bg-black/40 text-white/70 hover:text-white border-white/10 hover:border-white/20`,
          style: {},
        };
    }
  };

  const buttonStyles = getButtonStyles();
  const isDisabled = disabled;

  return (
    <button
      id={id}
      onClick={handleClick}
      className={`${buttonStyles.className} ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      style={!isDisabled ? buttonStyles.style : { ...buttonStyles.style, opacity: 0.5 }}
      onMouseEnter={!isDisabled ? buttonStyles.onMouseEnter : undefined}
      onMouseLeave={!isDisabled ? buttonStyles.onMouseLeave : undefined}
      title={tooltip}
      disabled={isDisabled}
    >
      <div className={effectiveVariant === "icon-only" ? `${getIconSize()} flex items-center justify-center` : `${getIconSize()} flex items-center justify-center`}>
        <Icon
          icon={icon}
          className={`${getIconSize()} ${iconClassName}`}
        />
      </div>
      {effectiveVariant !== "icon-only" && label && (
        <span style={{ transform: 'translateY(-0.075em)' }}>{label}</span>
      )}
    </button>
  );
}
