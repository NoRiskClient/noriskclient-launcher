"use client";

import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";
import { IconButton } from "./buttons/IconButton";
import { ModalScopeContext } from "./ModalScope";
import { isTopDialog, registerDialog } from "./modal-focus";

interface ModalProps {
  title: string;
  titleIcon?: React.ReactNode;
  titleSubtitle?: React.ReactNode;
  onClose: () => void;
  /** Synchronous veto before this modal commits to closing (e.g. a pending write). */
  canClose?: () => boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "sm" | "md" | "lg" | "xl" | "full";
  closeOnClickOutside?: boolean;
  closeOnEscape?: boolean;
  hideCloseButton?: boolean;
  /** Keep header text wrapping stable when a temporarily busy dialog hides Close. */
  reserveCloseButtonSpace?: boolean;
  headerActions?: React.ReactNode;
  variant?: "default" | "flat" | "3d";
  className?: string;
  contentClassName?: string;
}

export function Modal({
  title,
  titleIcon,
  titleSubtitle,
  onClose,
  canClose,
  children,
  footer,
  width = "md",
  closeOnClickOutside = true,
  closeOnEscape,
  hideCloseButton = false,
  reserveCloseButtonSpace = false,
  headerActions,
  variant = "default",
  className,
  contentClassName,
}: ModalProps) {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : document.activeElement as HTMLElement,
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mouseDownTargetRef = useRef<EventTarget | null>(null);
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const [isClosing, setIsClosing] = useState(false);
  const closingRef = useRef(false);
  const policyRef = useRef({ onClose, canClose, canEscape: closeOnEscape ?? !hideCloseButton });
  policyRef.current = { onClose, canClose, canEscape: closeOnEscape ?? !hideCloseButton };
  useEffect(() => {
    if (!panelRef.current) return;
    return registerDialog({
      panel: panelRef.current,
      id: dialogId,
      returnFocus: returnFocusRef.current,
      canEscape: () => policyRef.current.canEscape && !closingRef.current && (policyRef.current.canClose?.() ?? true),
      close: () => handleClose(),
    });
  }, [dialogId]);

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
    if (closingRef.current || !(policyRef.current.canClose?.() ?? true)) return;
    closingRef.current = true;
    setIsClosing(true);
    policyRef.current.onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (
      closeOnClickOutside &&
      isTopDialog(panelRef.current) &&
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
    <ModalScopeContext.Provider value={dialogId}>
    <div
      ref={modalRef}
      className="nrc-modal-overlay fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md-anyos"
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-modal-id={dialogId}
        className={cn(
          "nrc-modal-panel relative flex flex-col w-full rounded-lg overflow-hidden max-h-[90vh]",
          getBorderClasses(),
          variant === "3d" ? "shadow-2xl" : "",
          widthClasses[width],
          className,
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
          className="flex items-center justify-between px-6 py-4 border-b-2 flex-shrink-0"
          style={{
            borderColor: `${accentColor.value}60`,
            backgroundColor: `${accentColor.value}30`,
          }}
        >
          <div className="flex min-w-0 items-center space-x-3">
            {titleIcon && (
              <span className="text-white flex-shrink-0 flex items-center">
                {titleIcon}
              </span>
            )}
            <div className="flex min-w-0 flex-col">
              <h2 id={titleId} className="text-lg font-smallcaps text-white break-words">
                {title}
              </h2>
              {titleSubtitle && <div className="mt-0.5">{titleSubtitle}</div>}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center space-x-2">
            {headerActions}
            {(!hideCloseButton || reserveCloseButtonSpace) && (
              <IconButton
                ref={closeButtonRef}
                icon={<Icon icon="solar:close-circle-bold" />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleClose();
                }}
                variant="ghost"
                size="sm"
                disabled={hideCloseButton}
                aria-hidden={hideCloseButton || undefined}
                tabIndex={hideCloseButton ? -1 : undefined}
                className={hideCloseButton ? "invisible pointer-events-none" : undefined}
                aria-label={t('common.close_modal')}
              />
            )}
          </div>
        </div>

        <div
          ref={contentRef}
          className={cn("min-h-0 flex-1 overflow-y-auto custom-scrollbar", contentClassName)}
        >
          {children}
        </div>

        {footer && (
          <div className="flex-shrink-0">
            <div className="border-t border-white/10 mx-6 mt-4 mb-4"></div>
            <div className="px-6 pb-4">
              {footer}
            </div>
          </div>
        )}
      </div>
    </div>
    </ModalScopeContext.Provider>
  );
}
