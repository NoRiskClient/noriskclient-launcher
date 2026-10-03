"use client";

import type React from "react";

import { cn } from "../../../lib/utils";
import { useThemeStore } from "../../../store/useThemeStore";

interface DropdownItemProps {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  isActive?: boolean;
  icon?: React.ReactNode;
  disabled?: boolean;
  shortcut?: React.ReactNode;
  role?: string;
}

export function DropdownItem({
  className,
  children,
  onClick,
  isActive = false,
  icon,
  disabled = false,
  shortcut,
  role,
}: DropdownItemProps) {
  const accentColor = useThemeStore((state) => state.accentColor);

  return (    <button
      type="button"
      role={role}
      disabled={disabled}
      className={cn(
        "w-full px-4 py-2 text-left font-smallcaps text-xs transition-all duration-200",
        "flex items-center gap-3",
        disabled ? "cursor-not-allowed opacity-40" : "hover:bg-white/10 active:bg-white/5",
        isActive && "bg-white/15",
        className,
      )}
      onClick={onClick}
      style={{
        color: isActive ? accentColor.value : "white",
      }}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <span className="shrink-0 tabular-nums text-white/50">{shortcut}</span>}
    </button>
  );
}
