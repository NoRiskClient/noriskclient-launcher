import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";
import { MENU_PANEL_CLASSES, menuItemClasses, menuSeparatorClasses } from "./design-system";
import type { Profile } from "../../types/profile";

const EDGE = 8;

function clampMenuPosition(x: number, y: number, width: number, height: number): { x: number; y: number } {
  return {
    x: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
    y: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)),
  };
}

export function menuBelow(anchor: Element): { x: number; y: number } {
  const rect = anchor.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 4 };
}

export interface ContextMenuItem<T = Profile> {
  /** Unique identifier for the menu item */
  id: string;
  /** Label text to display */
  label: string;
  /** Icon to display */
  icon: string;
  /** Whether this is a destructive action (like delete) */
  destructive?: boolean;
  /** Whether to show a separator before this item */
  separator?: boolean;
  /** Whether this item is disabled */
  disabled?: boolean;
  /** Click handler */
  onClick: (target: T) => void;
}

export interface SettingsContextMenuProps<T = Profile> {
  /** The item this menu is for */
  target: T;
  /** Whether the menu is visible */
  isOpen: boolean;
  /** Position coordinates */
  position: { x: number; y: number };
  /** Menu items to display */
  items: ContextMenuItem<T>[];
  /** Close handler */
  onClose: () => void;
  /** Optional ref to the settings button that triggers this menu */
  triggerButtonRef?: React.RefObject<HTMLElement>;
  compact?: boolean;
}

export function SettingsContextMenu<T = Profile>({
  target,
  isOpen,
  position,
  items,
  onClose,
  triggerButtonRef,
  compact = false,
}: SettingsContextMenuProps<T>) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const menuRef = useRef<HTMLDivElement>(null);

  const [placed, setPlaced] = useState(position);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    setPlaced(clampMenuPosition(position.x, position.y, menu?.offsetWidth ?? 0, menu?.offsetHeight ?? 0));
  }, [position.x, position.y, isOpen, items.length]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      // Don't close if clicking inside the menu
      if (menuRef.current && menuRef.current.contains(target)) {
        return;
      }
      
      // Don't close if clicking on the trigger button or any button with data-action="settings" (let the button handle the toggle)
      if (triggerButtonRef?.current && triggerButtonRef.current.contains(target)) {
        return;
      }
      
      // Additional check: look for any settings button in the DOM tree (for list mode)
      const clickedElement = target as Element;
      const settingsButton = clickedElement.closest('button[data-action="settings"], button[title*="Profile Options"], button[title*="Profil Optionen"]');
      if (settingsButton) {
        return;
      }
      
      // Close if clicking anywhere else
      onClose();
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [isOpen, onClose]);

  // Close menu on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={`fixed z-[1100] ${MENU_PANEL_CLASSES}`}
      style={{
        left: placed.x,
        top: placed.y,
        minWidth: compact ? "176px" : "200px",
      }}
    >
      <div className="py-2">
        {items.map((item) => (
          <React.Fragment key={item.id}>
            {/* Separator */}
            {item.separator && (
              <div className={compact ? menuSeparatorClasses(true) : "h-px bg-white/10 mx-2 my-2"} />
            )}
            
            <button
              onClick={() => {
                if (!item.disabled) {
                  item.onClick(target);
                  onClose();
                }
              }}
              className={`${compact ? menuItemClasses(true) : "w-full flex items-center gap-3 px-4 py-3 text-left font-minecraft text-sm transition-colors duration-150"} ${
                item.disabled
                  ? 'text-white/30 cursor-not-allowed opacity-50'
                  : item.destructive
                    ? 'text-red-400 hover:bg-red-600/10 hover:text-red-300'
                    : 'text-white/80 hover:text-white'
              }`}
              style={{
                backgroundColor: item.destructive ? undefined : 'transparent',
              }}
              onMouseEnter={!item.destructive && !item.disabled ? (e) => {
                e.currentTarget.style.backgroundColor = `${accentColor.value}15`;
              } : undefined}
              onMouseLeave={!item.destructive && !item.disabled ? (e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              } : undefined}
              disabled={item.disabled}
            >
              <Icon 
                icon={item.icon} 
                className={`w-4 h-4 flex-shrink-0 ${
                  item.disabled
                    ? 'text-white/30'
                    : item.destructive 
                      ? 'text-red-400' 
                      : 'text-white/70'
                }`} 
              />
              <span className="flex-1">{item.label}</span>
            </button>
          </React.Fragment>
        ))}
      </div>
    </div>,
    document.body,
  );
}
