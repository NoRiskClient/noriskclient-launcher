"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";
import { IconButton } from "./buttons/IconButton";

interface ModalProps {
  title: string;
  titleIcon?: React.ReactNode;
  titleSubtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "sm" | "md" | "lg" | "xl" | "full";
  closeOnClickOutside?: boolean;
  headerActions?: React.ReactNode;
  variant?: "default" | "flat" | "3d";
}

export function Modal({
  title,
  titleIcon,
  titleSubtitle,
  onClose,
  children,
  footer,
  width = "md",
  closeOnClickOutside = true,
  headerActions,
  variant = "default",
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mouseDownTargetRef = useRef<EventTarget | null>(null);
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const [isClosing, setIsClosing] = useState(false);
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isClosing) {
        handleClose();
      }
    };
    
    if (closeOnClickOutside !== false) {
      window.addEventListener("keydown", handleEscape);
    }

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeOnClickOutside, isClosing]);

  useEffect(() => {
    const recordMouseDownTarget = (event: MouseEvent) => {
      mouseDownTargetRef.current = event.target;
    };

    document.addEventListener('mousedown', recordMouseDownTarget, true);

    return () => {
      document.removeEventListener('mousedown', recordMouseDownTarget, true);
      mouseDownTargetRef.current = null;
    };
  }, []);

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (
      closeOnClickOutside &&
      e.target === modalRef.current &&
      mouseDownTargetRef.current === modalRef.current &&
      !isClosing
    ) {
      e.stopPropagation();
      handleClose();
    }
  };

  const widthClasses = {
    sm: "max-w-lg",
    md: "max-w-2xl",
    lg: "max-w-3xl",
    xl: "max-w-5xl",
    full: "max-w-[95vw] w-full",
  };

  const getBorderClasses = () => {
    if (variant === "3d") {
      return "border-2 border-b-4";
    }
    return "border border-b-2";
  };

  const getBoxShadow = () => {
    if (variant === "3d") {
      return `0 10px 0 rgba(0,0,0,0.3), 0 15px 25px rgba(0,0,0,0.5), inset 0 1px 0 ${accentColor.value}40, inset 0 0 0 1px ${accentColor.value}20`;
    }
    return "none";
  };
  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
      onClick={handleBackdropClick}
    >
      <div
        ref={contentRef}
        className={cn(
          "relative flex flex-col w-full rounded-lg overflow-hidden",
          getBorderClasses(),
          variant === "3d" ? "shadow-2xl" : "",
          widthClasses[width],
          "max-h-[85vh]",
        )}
        style={{
          backgroundColor: `${accentColor.value}20`,
          borderColor: `${accentColor.value}80`,
          borderBottomColor: accentColor.value,
          boxShadow: getBoxShadow(),
        }}
      >
        {variant === "3d" && (
          <span
            className="absolute inset-x-0 top-0 h-[2px] rounded-t-sm"
            style={{ backgroundColor: `${accentColor.value}80` }}
          />
        )}

        <div
          ref={headerRef}
          className="flex items-center justify-between px-6 py-4 border-b-2"
          style={{
            borderColor: `${accentColor.value}60`,
            backgroundColor: `${accentColor.value}30`,
          }}
        >
          <div className="flex items-start space-x-3">
            {titleIcon && (
              <span className="text-white flex-shrink-0 pt-1.5">
                {titleIcon}
              </span>
            )}
            <div className="flex flex-col">
              <h2 className="text-3xl font-minecraft text-white lowercase">
                {title}
              </h2>
              {titleSubtitle && <div className="mt-0.5">{titleSubtitle}</div>}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {headerActions}
            <IconButton
              ref={closeButtonRef}
              icon={<Icon icon="solar:close-circle-bold" />}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              variant="ghost"
              size="sm"
              aria-label="Close modal"
            />
          </div>
        </div>        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {children}
        </div>{footer && (
          <div
            className="px-6 py-4 border-t-2 flex-shrink-0"
            style={{
              borderColor: `${accentColor.value}60`,
              backgroundColor: `${accentColor.value}15`,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
