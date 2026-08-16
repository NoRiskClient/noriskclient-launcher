"use client";

import React from "react";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";

export interface CheckboxV2Props {
  /** Whether the checkbox is checked */
  checked: boolean;
  /** Change handler */
  onChange: (checked: boolean) => void;
  /** Whether the checkbox is disabled */
  disabled?: boolean;
  /** Whether the checkbox is in indeterminate state */
  indeterminate?: boolean;
  /** Optional label text */
  label?: string;
  /** Optional tooltip text */
  tooltip?: string;
  /** Custom size */
  size?: "sm" | "md" | "lg";
  /** Additional CSS classes */
  className?: string;
  /** Click handler for the entire component */
  onClick?: (e: React.MouseEvent) => void;
}

export function CheckboxV2({
  checked,
  onChange,
  disabled = false,
  indeterminate = false,
  label,
  tooltip,
  size = "md",
  className = "",
  onClick,
}: CheckboxV2Props) {
  const accentColor = useThemeStore((state) => state.accentColor);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled) {
      onChange(!checked);
      if (onClick) {
        onClick(e);
      }
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case "sm":
        return "w-4 h-4";
      case "lg":
        return "w-6 h-6";
      default: // md
        return "w-5 h-5";
    }
  };

  const getIconSize = () => {
    switch (size) {
      case "sm":
        return "w-3 h-3";
      case "lg":
        return "w-4 h-4";
      default: // md
        return "w-3.5 h-3.5";
    }
  };

  const getLabelSize = () => {
    switch (size) {
      case "sm":
        return "text-xs";
      case "lg":
        return "text-base";
      default: // md
        return "text-sm";
    }
  };

  const getCheckboxStyles = () => {
    const baseClasses = `transition-all duration-200 border font-smallcaps rounded flex items-center justify-center cursor-pointer ${getSizeClasses()}`;
    
    if (checked || indeterminate) {
      return {
        className: `${baseClasses} text-white`,
        style: {
          backgroundColor: `${accentColor.value}50`,
          borderColor: `${accentColor.borderValue || accentColor.textValue || accentColor.value}90`,
          color: 'white',
        },
        onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
          if (!disabled) {
            e.currentTarget.style.backgroundColor = `${accentColor.value}60`;
            e.currentTarget.style.borderColor = `${accentColor.borderValue || accentColor.textValue || accentColor.value}`;
          }
        },
        onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => {
          if (!disabled) {
            e.currentTarget.style.backgroundColor = `${accentColor.value}50`;
            e.currentTarget.style.borderColor = `${accentColor.borderValue || accentColor.textValue || accentColor.value}90`;
          }
        },
      };
    } else {
      return {
        className: `${baseClasses} bg-black/50 hover:bg-black/60 text-white/70 hover:text-white border-white/30 hover:border-white/50`,
        style: {},
      };
    }
  };

  const checkboxStyles = getCheckboxStyles();
  const isDisabled = disabled;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        onClick={handleClick}
        className={`${checkboxStyles.className} ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        style={!isDisabled ? checkboxStyles.style : { ...checkboxStyles.style, opacity: 0.5 }}
        onMouseEnter={!isDisabled ? checkboxStyles.onMouseEnter : undefined}
        onMouseLeave={!isDisabled ? checkboxStyles.onMouseLeave : undefined}
        title={tooltip}
        role="checkbox"
        aria-checked={indeterminate ? "mixed" : checked}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled) {
            e.preventDefault();
            handleClick(e as any);
          }
        }}
      >
        {(checked || indeterminate) && (
          <Icon
            icon={indeterminate ? "mdi:minus" : "mingcute:check-line"}
            className={`${getIconSize()} transition-all duration-200`}
          />
        )}
      </div>

      {label && (
        <label
          onClick={!disabled ? handleClick : undefined}
          className={`font-smallcaps text-white cursor-pointer select-none ${getLabelSize()} ${
            disabled ? 'opacity-50 cursor-not-allowed' : 'hover:text-white/80'
          }`}
        >
          {label}
        </label>
      )}
    </div>
  );
}
