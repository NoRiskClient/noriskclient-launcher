"use client";

import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useThemeStore } from "../../store/useThemeStore";

interface TooltipProps {
  content: string | React.ReactNode;
  children: React.ReactNode;
  delay?: number;
  className?: string;
}

export function Tooltip({
  content,
  children,
  delay = 300,
  className = "",
}: TooltipProps) {
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

  const showTooltip = (e: React.MouseEvent) => {
    isHoveringRef.current = true;

    // Sofort die Position aktualisieren
    updateTooltipPosition(e.clientX, e.clientY);

    timeoutRef.current = setTimeout(() => {
      if (isHoveringRef.current) {
        setIsVisible(true);
      }
    }, delay);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
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
    const baseClasses = "fixed z-50 px-3 py-2 text-xs font-minecraft-ten text-white border-2 pointer-events-none transition-opacity duration-200 rounded-lg backdrop-blur-md";

    return `${baseClasses} ${className}`;
  };

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={showTooltip}
        onMouseMove={handleMouseMove}
        onMouseLeave={hideTooltip}
        className="inline-block"
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
