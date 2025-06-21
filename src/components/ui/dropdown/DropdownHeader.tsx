"use client";

import type React from "react";

import { cn } from "../../../lib/utils";
import { useThemeStore } from "../../../store/useThemeStore";

interface DropdownHeaderProps {
  title: string;
  className?: string;
  children?: React.ReactNode;
}

export function DropdownHeader({
  title,
  className,
  children,
}: DropdownHeaderProps) {
  const accentColor = useThemeStore((state) => state.accentColor);

  return (    <div
      className={cn(
        "px-4 py-3 font-minecraft text-xl text-white border-b-2 relative",
        "flex items-center justify-between",
        className,
      )}
      style={{
        backgroundColor: `${accentColor.value}25`,
        borderBottomColor: `${accentColor.value}50`,
      }}
    >
      <span className="text-shadow-sm">{title}</span>
      {children}
    </div>
  );
}
