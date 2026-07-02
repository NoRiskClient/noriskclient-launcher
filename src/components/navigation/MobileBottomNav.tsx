"use client";

import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";

interface NavItem {
  id: string;
  icon: string;
  label: string;
  isAction?: boolean;
}

interface MobileBottomNavProps {
  className?: string;
  items: NavItem[];
  activeItem?: string;
  onItemClick?: (id: string) => void;
}

export function MobileBottomNav({
  className,
  items,
  activeItem,
  onItemClick,
}: MobileBottomNavProps) {
  const accentColor = useThemeStore((state) => state.accentColor);

  return (
    <nav
      className={cn(
        "flex-shrink-0 flex items-stretch justify-around backdrop-blur-lg z-20",
        "h-16 pb-[env(safe-area-inset-bottom)]",
        className,
      )}
      style={{
        backgroundColor: `rgba(${parseInt(accentColor.value.slice(1, 3), 16)}, ${parseInt(accentColor.value.slice(3, 5), 16)}, ${parseInt(accentColor.value.slice(5, 7), 16)}, 0.35)`,
        borderTop: `2px solid ${accentColor.value}60`,
      }}
    >
      {items.map((item) => {
        const isActive = !item.isAction && activeItem === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onItemClick?.(item.id)}
            aria-label={item.label}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0",
              "bg-transparent border-none cursor-pointer transition-colors duration-150",
              isActive ? "text-white" : "text-white/50",
            )}
          >
            <Icon icon={item.icon} className="w-6 h-6" />
            <span className="font-minecraft-ten text-[9px] lowercase truncate max-w-full px-0.5">
              {item.label}
            </span>
            <span
              className="h-[3px] w-8 rounded-full transition-opacity duration-150"
              style={{
                backgroundColor: accentColor.value,
                opacity: isActive ? 1 : 0,
              }}
            />
          </button>
        );
      })}
    </nav>
  );
}
