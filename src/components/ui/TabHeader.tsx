"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { gsap } from "gsap";
import { useThemeStore } from "../../store/useThemeStore";
import { 
  getVariantColors,
  getAccessibilityProps
} from "./design-system";

interface TabHeaderProps {
  title: string;
  icon?: string;
  children?: ReactNode;
  className?: string;
  role?: string;
  ariaLabel?: string;
}

export function TabHeader({
  title,
  icon,
  children,
  className,
  role = "banner",
  ariaLabel,
}: TabHeaderProps) {
  const headerRef = useRef<HTMLDivElement>(null);
  const accentColor = useThemeStore((state) => state.accentColor);

  const colors = getVariantColors("default", accentColor);
  const accessibilityProps = getAccessibilityProps({
    label: ariaLabel
  });

  useEffect(() => {
    if (headerRef.current) {
      gsap.fromTo(
        headerRef.current,
        { opacity: 0, y: -20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          ease: "power2.out",
        },
      );
    }
  }, []);
  return (
    <div
      ref={headerRef}      className={cn(
        "flex-shrink-0 flex flex-col gap-4 p-6 backdrop-blur-md border-b-4 shadow-md",
        "rounded-none",
        className,
      )}
      style={{
        backgroundColor: `${colors.main}30`,
        borderColor: `${colors.main}60`,
        borderRadius: "0px",
      }}
      role={role}
      {...accessibilityProps}
    >      <div className="flex items-center gap-3">        {icon && (
          <Icon
            icon={icon}
            className="text-xl"
            style={{ color: colors.light }}
            aria-hidden="true"
          />
        )}
        <h1
          className="text-xl font-minecraft font-bold"
          style={{ color: "#ffffff" }}
        >
          {title}
        </h1>
      </div>
      {children}
    </div>
  );
}
