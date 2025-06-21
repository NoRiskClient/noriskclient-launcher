"use client";

import type React from "react";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../../lib/utils";
import { useThemeStore } from "../../../store/useThemeStore";
import { 
  getVariantColors,
  getBorderRadiusClass,
  createRadiusStyle,
  getAccessibilityProps
} from "../design-system";

interface DropdownProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement>;
  width?: number;
  className?: string;
  children: React.ReactNode;
  position?: "bottom" | "top" | "left" | "right";
  role?: string;
  ariaLabel?: string;
}

export const Dropdown = forwardRef<HTMLDivElement, DropdownProps>(
  (
    {
      isOpen,
      onClose,
      triggerRef,
      width = 300,
      className,
      children,
      position = "bottom",
      role = "menu",
      ariaLabel,
    },
    ref,
  ) => {
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [isMounted, setIsMounted] = useState(false);
    const [dropdownTop, setDropdownTop] = useState<number>(0);
    const [dropdownLeft, setDropdownLeft] = useState<number>(0);
    const [animationState, setAnimationState] = useState<
      "entering" | "entered" | "exiting" | "exited"
    >("exited");
    const accentColor = useThemeStore((state) => state.accentColor);
    const borderRadius = useThemeStore((state) => state.borderRadius);
    const previousIsOpen = useRef(isOpen);
    const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [dropdownHeight, setDropdownHeight] = useState(300);

    const colors = getVariantColors("default", accentColor);
    const radiusClass = getBorderRadiusClass(borderRadius);
    const accessibilityProps = getAccessibilityProps({
      label: ariaLabel
    });

    useEffect(() => {
      setIsMounted(true);
      return () => {
        setIsMounted(false);
        if (closeTimeoutRef.current) {
          clearTimeout(closeTimeoutRef.current);
        }
      };
    }, []);

    useEffect(() => {
      if (isOpen !== previousIsOpen.current) {
        if (isOpen) {
          if (closeTimeoutRef.current) {
            clearTimeout(closeTimeoutRef.current);
            closeTimeoutRef.current = null;
          }

          setAnimationState("entering");
          setTimeout(() => {
            if (isMounted) {
              setAnimationState("entered");
            }
          }, 10);
        } else if (
          animationState === "entered" ||
          animationState === "entering"
        ) {
          setAnimationState("exiting");

          closeTimeoutRef.current = setTimeout(() => {
            if (isMounted) {
              setAnimationState("exited");
            }
            closeTimeoutRef.current = null;
          }, 200);
        }

        previousIsOpen.current = isOpen;
      }    }, [isOpen, animationState, isMounted]);

    useEffect(() => {
      if (isOpen && dropdownRef.current && animationState === "entered") {
        const height = dropdownRef.current.offsetHeight;
        setDropdownHeight(height);
        calculatePosition(height);
      }
    }, [isOpen, animationState]);

    const calculatePosition = useCallback(
      (actualHeight?: number) => {
        if (!isOpen || !triggerRef.current) return;

        const rect = triggerRef.current.getBoundingClientRect();
        let top = 0;
        let left = 0;

        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;        const scrollY = window.scrollY || window.pageYOffset;
        const scrollX = window.scrollX || window.pageXOffset;

        const estimatedHeight = actualHeight || Math.min(400, dropdownHeight);
        const offset = 12;

        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;

        let effectivePosition = position;
        if (
          position === "bottom" &&
          spaceBelow < estimatedHeight &&
          spaceAbove > estimatedHeight
        ) {
          effectivePosition = "top";
        } else if (
          position === "top" &&
          spaceAbove < estimatedHeight &&
          spaceBelow > estimatedHeight
        ) {
          effectivePosition = "bottom";
        }

        switch (effectivePosition) {
          case "bottom":
            top = rect.bottom + scrollY + offset;
            left = rect.left + scrollX + rect.width / 2 - width / 2;
            break;
          case "top":
            top = rect.top + scrollY - estimatedHeight - offset;
            left = rect.left + scrollX + rect.width / 2 - width / 2;
            break;
          case "left":
            top = rect.top + scrollY + rect.height / 2 - estimatedHeight / 2;
            left = rect.left + scrollX - width - offset;
            break;
          case "right":
            top = rect.top + scrollY + rect.height / 2 - estimatedHeight / 2;
            left = rect.right + scrollX + offset;
            break;        }

        const padding = 16;
        left = Math.max(padding + scrollX, left);
        left = Math.min(left, viewportWidth + scrollX - width - padding);

        top = Math.max(padding + scrollY, top);

        if (top + estimatedHeight > viewportHeight + scrollY - padding) {
          if (rect.top - estimatedHeight - offset > padding) {
            top = rect.top + scrollY - estimatedHeight - offset;
          } else {
            top = viewportHeight + scrollY - estimatedHeight - padding;
          }
        }

        setDropdownTop(top);
        setDropdownLeft(left);
      },
      [isOpen, triggerRef, width, position, dropdownHeight],
    );

    useEffect(() => {
      const handleResizeOrScroll = () => calculatePosition();

      if (isOpen) {
        calculatePosition();
        window.addEventListener("resize", handleResizeOrScroll);
        window.addEventListener("scroll", handleResizeOrScroll, true);
      }

      return () => {
        window.removeEventListener("resize", handleResizeOrScroll);
        window.removeEventListener("scroll", handleResizeOrScroll, true);
      };
    }, [isOpen, calculatePosition]);
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (
          dropdownRef.current &&
          !dropdownRef.current.contains(event.target as Node) &&
          triggerRef.current &&
          !triggerRef.current.contains(event.target as Node)
        ) {
          onClose();
        }
      };

      if (isOpen) {
        setTimeout(() => {
          document.addEventListener("mousedown", handleClickOutside);
        }, 0);
      }

      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }, [isOpen, onClose, triggerRef]);

    if (!isMounted || animationState === "exited") {
      return null;
    }

    const getAnimationClasses = () => {
      switch (position) {
        case "bottom":
          return {
            entering: "opacity-0 translate-y-[-10px]",
            entered: "opacity-100 translate-y-0",
            exiting: "opacity-0 translate-y-[-10px]",
          };
        case "top":
          return {
            entering: "opacity-0 translate-y-[10px]",
            entered: "opacity-100 translate-y-0",
            exiting: "opacity-0 translate-y-[10px]",
          };
        case "left":
          return {
            entering: "opacity-0 translate-x-[10px]",
            entered: "opacity-100 translate-x-0",
            exiting: "opacity-0 translate-x-[10px]",
          };
        case "right":
          return {
            entering: "opacity-0 translate-x-[-10px]",
            entered: "opacity-100 translate-x-0",
            exiting: "opacity-0 translate-x-[-10px]",
          };
      }
    };

    const animationClasses = getAnimationClasses();    return createPortal(
      <div
        ref={(node) => {
          if (ref) {
            if (typeof ref === "function") {
              ref(node);
            } else {
              ref.current = node;
            }
          }
          dropdownRef.current = node;
        }}
        role={role}
        className={cn(
          "fixed font-minecraft backdrop-blur-md z-50 overflow-hidden",
          radiusClass,
          "text-white transition-all duration-200",
          "border-2 border-b-4 shadow-[0_8px_0_rgba(0,0,0,0.3),0_10px_15px_rgba(0,0,0,0.35)]",
          animationState === "entering" && animationClasses.entering,
          animationState === "entered" && animationClasses.entered,
          animationState === "exiting" && animationClasses.exiting,
          className,
        )}
        style={{
          top: `${dropdownTop}px`,
          left: `${dropdownLeft}px`,
          width: `${width}px`,
          backgroundColor: `${colors.main}15`,
          borderColor: `${colors.main}40`,
          borderBottomColor: colors.dark,
          boxShadow: `0 8px 0 rgba(0,0,0,0.3), 0 10px 15px rgba(0,0,0,0.35), inset 0 1px 0 ${colors.light}20, inset 0 0 0 1px ${colors.main}10`,
          ...createRadiusStyle(borderRadius),
        }}
        {...accessibilityProps}
      >
        <div className="absolute inset-0 opacity-20 bg-gradient-radial from-white/20 via-transparent to-transparent pointer-events-none" />
        <div className="relative z-10">{children}</div>
      </div>,
      document.body,
    );
  },
);

Dropdown.displayName = "Dropdown";