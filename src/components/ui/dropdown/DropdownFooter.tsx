"use client";

import type React from "react";

import { cn } from "../../../lib/utils";
import { useThemeStore } from "../../../store/useThemeStore";

interface DropdownFooterProps {
  className?: string;
  children: React.ReactNode;
}

export function DropdownFooter({ className, children }: DropdownFooterProps) {
  const accentColor = useThemeStore((state) => state.accentColor);

  return (
    <div
      className={cn(
        "px-4 py-3 border-t-2 flex items-center justify-end gap-2",
        className,
      )}
      style={{
        backgroundColor: `${accentColor.value}15`,
        borderTopColor: `${accentColor.borderValue || accentColor.textValue || accentColor.value}30`,
      }}
    >
      {children}
    </div>
  );
}
