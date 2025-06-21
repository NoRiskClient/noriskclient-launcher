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
}

export function DropdownItem({
  className,
  children,
  onClick,
  isActive = false,
  icon,
}: DropdownItemProps) {
  const accentColor = useThemeStore((state) => state.accentColor);

  return (    <button
      className={cn(
        "w-full px-4 py-2 text-left font-minecraft text-lg transition-all duration-200 lowercase",
        "flex items-center gap-3",
        "hover:bg-white/10",
        "active:bg-white/5",
        isActive && "bg-white/15",
        className,
      )}
      onClick={onClick}
      style={{
        color: isActive ? accentColor.value : "white",
      }}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      <span className="truncate">{children}</span>
    </button>
  );
}
