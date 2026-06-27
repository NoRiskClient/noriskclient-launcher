"use client";

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useThemeStore } from "../../store/useThemeStore";

interface TooltipProps {
  content: string | React.ReactNode;
  children: React.ReactNode;
  delay?: number;
  className?: string;
  // "cursor" (default): follows the mouse. "top": static, centered above the trigger element.
  position?: "cursor" | "top";
}

export function Tooltip({
  content,
  children,
  delay = 300,
  className = "",
  position = "cursor",
}: TooltipProps) {
  const isStatic = position === "top";
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const isHoveringRef = useRef(false);

  // Theme values
  const accentColor = useThemeStore((state) => state.accentColor);

  const updateTooltipPosition = (clientX: number, clientY: number) => {
    let x = clientX + 8;
    let y = clientY + 8;

    const tooltipWidth = tooltipRef.current?.offsetWidth || 200;
    const tooltipHeight = tooltipRef.current?.offsetHeight || 30;

    if (x + tooltipWidth > window.innerWidth) {
      x = clientX - tooltipWidth - 8;
    }

    if (y + tooltipHeight > window.innerHeight) {
      y = clientY - tooltipHeight - 8;
    }

    x = Math.max(8, x);
    y = Math.max(8, y);

    setTooltipPosition({ x, y });
  };

  // Static mode: anchor centered above the trigger. The `translate(-50%, -100%)` on the
  // tooltip element handles centering + sitting above, so we only need the top-center point.
  const positionAboveTrigger = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipPosition({ x: rect.left + rect.width / 2, y: rect.top - 8 });
  };

  const showTooltip = (e: React.MouseEvent) => {
    isHoveringRef.current = true;

    // Sofort die Position aktualisieren
    if (isStatic) {
      positionAboveTrigger();
    } else {
      updateTooltipPosition(e.clientX, e.clientY);
    }

    timeoutRef.current = setTimeout(() => {
      if (isHoveringRef.current) {
        setIsVisible(true);
      }
    }, delay);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isStatic) return; // static tooltip doesn't follow the cursor
    if (isHoveringRef.current) {
      updateTooltipPosition(e.clientX, e.clientY);
      // Wenn der Tooltip noch nicht sichtbar ist, zeige ihn sofort
      if (!isVisible && timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        setIsVisible(true);
      }
    }
  };

  const hideTooltip = () => {
    isHoveringRef.current = false;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const getTooltipClasses = () => {
    // z above modals/overlays (Modal + global modal portal use z-[1000]) so tooltips render on top
    const baseClasses = "fixed z-[1100] px-3 py-2 text-xs font-minecraft-ten text-white border-2 pointer-events-none transition-opacity duration-200 rounded-lg backdrop-blur-md";

    return `${baseClasses} ${className}`;
  };

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={showTooltip}
        onMouseMove={handleMouseMove}
        onMouseLeave={hideTooltip}
        // `inline-flex items-center` instead of `inline-block` so the trigger
        // wrapper has the same baseline/alignment semantics as the chips + icon
        // buttons around it in flex rows. Plain `inline-block` was offsetting
        // wrapped children by ~1px because its baseline sits on the last line
        // of text while neighboring `inline-flex` items center their content.
        className="inline-flex items-center"
      >
        {children}
      </div>

      {isVisible && createPortal(
        <div
          ref={tooltipRef}
          className={getTooltipClasses()}
          style={{
            left: tooltipPosition.x,
            top: tooltipPosition.y,
            position: 'fixed',
            // static mode: center horizontally on the anchor point and sit above it
            transform: isStatic ? 'translate(-50%, -100%)' : undefined,
            textAlign: isStatic ? 'center' : undefined,
            backgroundColor: `${accentColor.value}20`, // Wie ProfileIconV2
            borderColor: `${accentColor.value}60`, // Wie ProfileIconV2
            maxWidth: '300px', // Kompakt für kürzere Texte
            wordWrap: 'break-word', // Automatischer Wortumbruch
          }}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
}

// Convenience component for simple tooltip usage
interface SimpleTooltipProps extends Omit<TooltipProps, 'children'> {
  children: React.ReactNode;
}

export function SimpleTooltip(props: SimpleTooltipProps) {
  return <Tooltip {...props} />;
}

// Static tooltip: shown centered above the trigger element instead of following the cursor.
export function StaticTooltip(props: Omit<TooltipProps, 'position'>) {
  return <Tooltip {...props} position="top" />;
}
