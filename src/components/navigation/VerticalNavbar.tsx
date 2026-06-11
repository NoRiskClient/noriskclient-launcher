"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { Logo } from "../ui/Logo";
import { NavButton } from "../ui/nav/NavButton";
import { NavTooltip } from "../ui/nav/NavTooltip";
import { CreditsModal } from "../modals/CreditsModal";
import * as ConfigService from "../../services/launcher-config-service";
import { useThemeStore } from "../../store/useThemeStore";
import { createPortal } from "react-dom";

interface NavItem {
  id: string;
  icon: string;
  imageSrc?: string;
  label: string;
  action?: () => void;
}

interface VerticalNavbarProps {
  className?: string;
  items: NavItem[];
  activeItem?: string;
  onItemClick?: (id: string) => void;
  version?: string;
}

export function VerticalNavbar({
  className,
  items,
  activeItem,
  onItemClick,
  version = "v0.5.22",
}: VerticalNavbarProps) {  const [active, setActive] = useState(activeItem || items[0]?.id);
  const navRef = useRef<HTMLDivElement>(null);
  const [showTooltip, setShowTooltip] = useState<string | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const accentColor = useThemeStore((state) => state.accentColor);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const [isMounted, setIsMounted] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  useEffect(() => {
    if (activeItem) {
      setActive(activeItem);
    }
  }, [activeItem]);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const fetchedVersion = await ConfigService.getAppVersion();
        setAppVersion(`v${fetchedVersion}`);
      } catch (error) {
        console.error("Failed to fetch app version:", error);
        setAppVersion("v?.?.?");
      }
    };
    fetchVersion();
  }, []);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.set(".nav-item", { opacity: 0, x: -20 });

      gsap.to(".nav-item", {
        opacity: 1,
        x: 0,
        stagger: 0.05,
        duration: 0.4,
        ease: "power2.out",
        onComplete: () => {
          gsap.set(".nav-item", { clearProps: "all" });
        },
      });
    }, navRef);

    return () => ctx.revert();
  }, []);

  const handleItemClick = (id: string) => {
    setActive(id);
    if (onItemClick) {
      onItemClick(id);
    }
  };

  const handleMouseEnter = (id: string) => {
    const buttonElement = buttonRefs.current[id];
    if (buttonElement) {
      const rect = buttonElement.getBoundingClientRect();
      setTooltipPosition({
        top: rect.top + rect.height / 2,
        left: rect.right + 12,
      });
    }

    setShowTooltip(id);
    if (tooltipRef.current) {
      gsap.fromTo(
        tooltipRef.current,
        { opacity: 0, x: -10 },
        { opacity: 1, x: 0, duration: 0.3, ease: "power2.out" },
      );
    }
  };

  const handleMouseLeave = () => {
    setShowTooltip(null);
  };

  const mainItems = items.filter((item) => item.id !== "settings");
  const bottomItems = items.filter((item) => item.id === "settings");
  const renderNavItem = (item: NavItem) => (
    <div
      key={item.id}
      className="relative group nav-item"
      ref={(el) => (buttonRefs.current[item.id] = el)}
    >
      <NavButton
        icon={
          item.imageSrc ? (
            <span className="w-9 h-9 overflow-hidden rounded-lg flex items-center justify-center">
              <img
                src={item.imageSrc}
                alt=""
                className={`w-9 h-9 object-cover ${item.id === "ai" ? "scale-[3]" : ""}`}
                draggable={false}
              />
            </span>
          ) : (
            <Icon icon={item.icon} className="w-8 h-8" />
          )
        }
        isActive={active === item.id}
        onClick={() => handleItemClick(item.id)}
        onMouseEnter={() => handleMouseEnter(item.id)}
        onMouseLeave={handleMouseLeave}
        aria-label={item.label}
      />
    </div>
  );

  return (
    <>
      <div
        ref={navRef}
        className={cn(
          "flex flex-col items-center py-6 w-24 backdrop-blur-lg",
          className,
        )}
        style={{
          backgroundColor: `rgba(${parseInt(accentColor.value.slice(1, 3), 16)}, ${parseInt(accentColor.value.slice(3, 5), 16)}, ${parseInt(accentColor.value.slice(5, 7), 16)}, 0.4)`,
          borderRight: `2px solid ${accentColor.value}60`,
          borderLeft: `2px solid ${accentColor.value}60`,
          boxShadow: `0 0 10px ${accentColor.value}30 inset`,
        }}
      >        <div className="mb-12">
          <Logo size="sm" onClick={() => setShowCreditsModal(true)} />
        </div>

        <div className="flex-1 flex flex-col items-center space-y-4 min-h-[400px]">
          {mainItems.map(renderNavItem)}
        </div>

        <div className="mt-auto flex flex-col items-center space-y-4 pt-4">
          {bottomItems.map(renderNavItem)}
        </div>
      </div>      {isMounted &&
        showTooltip &&
        document.body &&
        createPortal(
          <div
            className="fixed pointer-events-none"
            style={{
              top: `${tooltipPosition.top}px`,
              left: `${tooltipPosition.left}px`,
              zIndex: 9999,
              transform: "translateY(-50%)",
            }}
          >
            <NavTooltip ref={tooltipRef}>
              {items.find((item) => item.id === showTooltip)?.label}
            </NavTooltip>
          </div>,
          document.body,
        )}

      <CreditsModal
        isOpen={showCreditsModal}
        onClose={() => setShowCreditsModal(false)}
      />
    </>
  );
}
