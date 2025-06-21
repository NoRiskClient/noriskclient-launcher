"use client";

import type React from "react";
import { useEffect, useRef } from "react";
import { cn } from "../../lib/utils";
import { gsap } from "gsap";
import { useThemeStore } from "../../store/useThemeStore";
import { 
  getVariantColors,
  getAccessibilityProps
} from "./design-system";

interface TabContentProps {
  children: React.ReactNode;
  className?: string;
  active?: boolean;
  role?: string;
  ariaLabel?: string;
}

export function TabContent({
  children,
  className,
  active = true,
  role = "tabpanel",
  ariaLabel,
}: TabContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const accentColor = useThemeStore((state) => state.accentColor);

  const colors = getVariantColors("default", accentColor);
  const accessibilityProps = getAccessibilityProps({
    label: ariaLabel
  });

  useEffect(() => {
    if (contentRef.current && active) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          ease: "power2.out",
        },
      );
    }
  }, [active]);

  return (
    <div
      ref={contentRef}
      role={role}
      aria-hidden={!active}      className={cn(
        "relative flex-1 min-h-0 p-4 overflow-auto custom-scrollbar rounded-none",
        className,
      )}
      style={{
        backgroundColor: `${colors.main}10`,
        boxShadow: `inset 0 1px 0 ${colors.main}20, inset 0 0 0 1px ${colors.main}10`,
        borderRadius: "0px",
      }}
      {...accessibilityProps}
    >
      {children}
    </div>
  );
}
