"use client";

import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";
import { Icon } from "@iconify/react";
import { SearchInput } from "./SearchInput";
import type { ReactNode } from "react";
import { 
  getVariantColors,
  getAccessibilityProps
} from "./design-system";

type TabLayoutProps = {
  title: string;
  icon?: string;
  children: ReactNode;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
  role?: string;
  ariaLabel?: string;
};

export function TabLayout({
  title,
  icon,
  children,
  search,
  actions,
  className,
  contentClassName,
  role = "main",
  ariaLabel,
}: TabLayoutProps) {
  const accentColor = useThemeStore((state) => state.accentColor);

  const colors = getVariantColors("default", accentColor);
  const accessibilityProps = getAccessibilityProps({
    label: ariaLabel
  });

  const headerStyle = {
    backgroundColor: `${colors.main}15`,
    borderColor: `${colors.main}60`,
    boxShadow: `0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)`,
    borderRadius: "0px",
  };

  const contentStyle = {
    borderColor: `${colors.main}40`,
  };
  return (
    <div 
      role={role}
      className={cn("flex flex-col h-full overflow-hidden", className)}
      {...accessibilityProps}
    >
      <header        className={cn(
          "flex flex-col md:flex-row md:items-center justify-between gap-4 px-6 py-4 border-b-2 sticky top-0 z-10",
          "backdrop-blur-md transition-all duration-200 rounded-none",
        )}
        style={headerStyle}
      >
        <div className="flex items-center gap-3">
          {icon && (
            <Icon
              icon={icon}
              className="w-6 h-6 text-white"
              style={{ color: colors.main }}
              aria-hidden="true"
            />
          )}          <h1 className="font-minecraft text-xl lowercase text-white">
            {title}
          </h1>
        </div>

        <div className="flex items-center gap-3 flex-wrap md:flex-nowrap">
          {search && (
            <SearchInput
              value={search.value}
              onChange={search.onChange}
              placeholder={search.placeholder || "Search..."}
              className="w-full md:w-auto flex-grow md:flex-grow-0 h-[42px]"
              variant="flat"
              aria-label={`Search ${title.toLowerCase()}`}
            />
          )}
          {actions && (
            <div role="toolbar" aria-label="Actions">
              {actions}
            </div>
          )}
        </div>
      </header>

      <main
        className={cn(
          "flex-1 p-6 overflow-y-auto custom-scrollbar",
          contentClassName,
        )}
        style={contentStyle}
      >
        {children}
      </main>
    </div>
  );
}
