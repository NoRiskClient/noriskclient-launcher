"use client";

import {
  type ForwardedRef,
  forwardRef,
  useEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "@iconify/react";
import type { Profile } from "../../types/profile";
import { useThemeStore } from "../../store/useThemeStore";
import { createPortal } from "react-dom";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { gsap } from "gsap";

interface ProfileContextMenuProps {
  profile: Profile;
  visible: boolean;
  x: number;
  y: number;
  onClose: () => void;
  onDelete: (profileId: string, profileName: string) => void;
  onDuplicate: () => void;
  onOpenFolder: () => void;
  onExport: () => void;
  onOpenSettings: () => void;
  onRepair?: () => void;
}

// Helper function to calculate optimal menu position
const calculateMenuPosition = (x: number, y: number, menuWidth: number, menuHeight: number) => {
  const viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
  
  const padding = 16; // Distance from viewport edges
  
  let adjustedX = x;
  let adjustedY = y;
  
  // Adjust horizontal position
  if (x + menuWidth + padding > viewport.width) {
    adjustedX = x - menuWidth; // Show menu to the left of cursor
    if (adjustedX < padding) {
      adjustedX = viewport.width - menuWidth - padding; // Align with right edge
    }
  }
  
  // Adjust vertical position
  if (y + menuHeight + padding > viewport.height) {
    adjustedY = y - menuHeight; // Show menu above cursor
    if (adjustedY < padding) {
      adjustedY = viewport.height - menuHeight - padding; // Align with bottom edge
    }
  }
  
  // Ensure minimum padding from edges
  adjustedX = Math.max(padding, Math.min(adjustedX, viewport.width - menuWidth - padding));
  adjustedY = Math.max(padding, Math.min(adjustedY, viewport.height - menuHeight - padding));
  
  return { x: adjustedX, y: adjustedY };
};

export const ProfileContextMenu = forwardRef<
  HTMLDivElement,
  ProfileContextMenuProps
>(function ProfileContextMenuComponent(
  {
    profile,
    visible,
    x,
    y,
    onClose,
    onDelete,
    onDuplicate,
    onOpenFolder,
    onExport,
    onOpenSettings,
    onRepair,
  },
  ref: ForwardedRef<HTMLDivElement>,
) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  const [adjustedPosition, setAdjustedPosition] = useState({ x, y });
  const { confirm, confirmDialog } = useConfirmDialog();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPortalNode(document.body);
  }, []);

  // Calculate and set adjusted position when coordinates change
  useEffect(() => {
    if (visible && menuRef.current) {
      // Use a rough estimate for menu dimensions or measure actual dimensions
      const menuWidth = 220; // Approximate width based on content
      // Calculate height based on profile type and available options
      let menuHeight = 140; // Base height for duplicate, open folder, export
      
      if (!profile.is_standard_version) {
        menuHeight = 240; // Non-standard: settings + delete + separators
      } else if (onRepair) {
        menuHeight = 180; // Standard with repair: repair button + separator
      }
      
      const newPosition = calculateMenuPosition(x, y, menuWidth, menuHeight);
      setAdjustedPosition(newPosition);
    } else {
      setAdjustedPosition({ x, y });
    }
  }, [x, y, visible, profile.is_standard_version, onRepair]);

  useEffect(() => {
    if (visible && menuRef.current) {
      gsap.fromTo(
        menuRef.current,
        {
          opacity: 0,
          scale: 0.95,
          y: -10,
        },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 0.2,
          ease: "power2.out",
        },
      );
    }
  }, [visible]);

  if (!visible || !portalNode) {
    return null;
  }

  const handleAction = (action?: () => void) => {
    console.log("[ContextMenu] handleAction called");

    if (menuRef.current) {
      gsap.to(menuRef.current, {
        opacity: 0,
        scale: 0.95,
        y: -5,
        duration: 0.15,
        ease: "power2.in",
        onComplete: () => {
          if (typeof action === 'function') {
            action();
          }
          onClose();
        },
      });
    } else {
      if (typeof action === 'function') {
        action();
      }
      onClose();
    }
  };

  const menuContent = (
    <div
      ref={(node) => {
        if (ref) {
          if (typeof ref === "function") {
            ref(node);
          } else {
            ref.current = node;
          }
        }
        menuRef.current = node;
      }}
      className="fixed z-[9999] rounded-md shadow-xl border-2 border-b-4 overflow-hidden"
      style={{
        top: adjustedPosition.y,
        left: adjustedPosition.x,
        backgroundColor: accentColor.value + "20",
        borderColor: accentColor.value + "90",
        borderBottomColor: accentColor.value,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        boxShadow:
          "0 8px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <span
        className="absolute inset-x-0 top-0 h-[2px] rounded-t-sm"
        style={{ backgroundColor: `${accentColor.value}80` }}
      />

      <ul className="py-1">
        {!profile.is_standard_version && (
          <>
            <li
              className="px-4 py-2.5 flex items-center gap-3 hover:bg-white/10 cursor-pointer transition-colors duration-150"
              onClick={(e) => {
                e.stopPropagation();
                console.log("[ContextMenu] Settings item clicked");
                handleAction(onOpenSettings);
              }}
            >
              <Icon icon="solar:settings-bold" className="w-5 h-5 text-white" />
              <span className="font-minecraft-ten text-base text-white/80">
                Settings
              </span>
            </li>
            <li className="px-4 py-1">
              <div
                className="h-px"
                style={{ backgroundColor: accentColor.value + "40" }}
              />
            </li>
          </>
        )}
        <li
          className="px-4 py-2.5 flex items-center gap-3 hover:bg-white/10 cursor-pointer transition-colors duration-150"
          onClick={(e) => {
            e.stopPropagation();
            console.log("[ContextMenu] Duplicate item clicked");
            handleAction(onDuplicate);
          }}
        >
          <Icon icon="solar:copy-bold" className="w-5 h-5 text-white" />
          <span className="font-minecraft-ten text-base text-white/80">
            Clone Profile
          </span>
        </li>
        <li
          className="px-4 py-2.5 flex items-center gap-3 hover:bg-white/10 cursor-pointer transition-colors duration-150"
          onClick={(e) => {
            e.stopPropagation();
            console.log("[ContextMenu] Open Folder item clicked");
            handleAction(onOpenFolder);
          }}
        >
          <Icon
            icon="solar:folder-with-files-bold"
            className="w-5 h-5 text-white"
          />
          <span className="font-minecraft-ten text-base text-white/80">
            Open Profile Folder
          </span>
        </li>
        <li
          className="px-4 py-2.5 flex items-center gap-3 hover:bg-white/10 cursor-pointer transition-colors duration-150"
          onClick={(e) => {
            e.stopPropagation();
            console.log("[ContextMenu] Export item clicked");
            handleAction(onExport);
          }}
        >
          <Icon
            icon="solar:export-bold"
            className="w-5 h-5 text-white"
          />
          <span className="font-minecraft-ten text-base text-white/80">
            Export Profile
          </span>
        </li>

        {profile.is_standard_version && onRepair && (
          <>
            <li className="px-4 py-1">
              <div
                className="h-px"
                style={{ backgroundColor: accentColor.value + "40" }}
              />
            </li>
            <li
              className="px-4 py-2.5 flex items-center gap-3 hover:bg-white/10 cursor-pointer transition-colors duration-150"
              onClick={(e) => {
                e.stopPropagation();
                console.log("[ContextMenu] Repair item clicked");
                handleAction(onRepair);
              }}
            >
              <Icon
                icon="solar:shield-check-bold"
                className="w-5 h-5 text-white"
              />
              <span className="font-minecraft-ten text-base text-white/80">
                Repair Profile
              </span>
            </li>
          </>
        )}

        {!profile.is_standard_version && (
          <>
            <li className="px-4 py-1">
              <div
                className="h-px"
                style={{ backgroundColor: accentColor.value + "40" }}
              />
            </li>
            <li
              className="px-4 py-2.5 flex items-center gap-3 hover:bg-red-500/20 cursor-pointer transition-colors duration-150"
              onClick={(e) => {
                e.stopPropagation();
                console.log(
                  "[ContextMenu] Delete item clicked - will call handleAction",
                );
                handleAction(() => onDelete(profile.id, profile.name));
              }}
            >
              <Icon
                icon="solar:trash-bin-trash-bold"
                className="w-5 h-5 text-red-400"
              />
              <span className="font-minecraft-ten text-base text-red-400">
                Delete Profile
              </span>
            </li>
          </>
        )}
      </ul>
      {confirmDialog}
    </div>
  );

  return createPortal(menuContent, portalNode);
});

ProfileContextMenu.displayName = "ProfileContextMenu";
