"use client";

import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { gsap } from "gsap";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { Logo } from "../ui/Logo";
import { NavButton } from "../ui/nav/NavButton";
import { Tooltip } from "../ui/Tooltip";
import { CreditsModal } from "../modals/CreditsModal";
import { useThemeStore } from "../../store/useThemeStore";
import { useAnimationsEnabled } from "../../hooks/useEntranceAnimation";

interface NavItem {
  id: string;
  icon: string;
  label: string;
  action?: () => void;
  isAction?: boolean;
}

interface VerticalNavbarProps {
  className?: string;
  items: NavItem[];
  activeItem?: string;
  onItemClick?: (id: string) => void;
  version?: string;
}

export function VerticalNavbar({ className, items, activeItem, onItemClick }: VerticalNavbarProps) {
  const location = useLocation();
  const [active, setActive] = useState(activeItem || items[0]?.id);
  const navRef = useRef<HTMLDivElement>(null);
  const accentColor = useThemeStore(state => state.accentColor);
  const showNavLabels = useThemeStore(state => state.showNavLabels);
  const animationsEnabled = useAnimationsEnabled();
  const [showCreditsModal, setShowCreditsModal] = useState(false);

  useEffect(() => { if (activeItem) setActive(activeItem); }, [activeItem]);
  useEffect(() => {
    if (!animationsEnabled) return;
    const context = gsap.context(() => {
      gsap.fromTo(".nav-item", { opacity: 0, x: -20 }, {
        opacity: 1, x: 0, stagger: 0.05, duration: 0.4, ease: "power2.out",
      });
    }, navRef);
    return () => context.revert();
  }, [animationsEnabled]);

  const renderItem = (item: NavItem) => {
    const label = !item.isAction && showNavLabels ? item.label : undefined;
    const button = <NavButton
        type="button"
        icon={<Icon aria-hidden="true" icon={item.icon} className="w-8 h-8" />}
        label={label}
        className={showNavLabels ? "w-20 h-20" : "w-16 h-16"}
        isActive={active === item.id}
        aria-current={!item.isAction && active === item.id ? "page" : undefined}
        onClick={() => { if (!item.isAction) setActive(item.id); onItemClick?.(item.id); }}
        aria-label={item.label}
      />;

    return <div key={item.id} className="relative group nav-item shrink-0 flex flex-col items-center">
      {label ? button : <Tooltip content={item.label} position="top" dismissKey={location.key}>{button}</Tooltip>}
    </div>;
  };

  return <>
    <div ref={navRef} className={cn("flex flex-col items-center py-4 min-h-0 shrink-0 backdrop-blur-lg", showNavLabels ? "w-28" : "w-24", className)}
      style={{
        backgroundColor: `rgba(${parseInt(accentColor.value.slice(1, 3), 16)}, ${parseInt(accentColor.value.slice(3, 5), 16)}, ${parseInt(accentColor.value.slice(5, 7), 16)}, 0.4)`,
        borderRight: `2px solid ${accentColor.value}60`, borderLeft: `2px solid ${accentColor.value}60`,
        boxShadow: `0 0 10px ${accentColor.value}30 inset`,
      }}>
      <div className="mb-6 shrink-0"><Logo size="sm" onClick={() => setShowCreditsModal(true)} /></div>
      <div className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden custom-scrollbar">
        <div className="flex flex-col items-center gap-3 px-2 py-1">
          {items.filter(item => !item.isAction).map(renderItem)}
        </div>
      </div>
      {items.some(item => item.isAction) && <div className="shrink-0 flex flex-col items-center gap-3 mt-3">
        {items.filter(item => item.isAction).map(renderItem)}
      </div>}
    </div>
    <CreditsModal isOpen={showCreditsModal} onClose={() => setShowCreditsModal(false)} />
  </>;
}
