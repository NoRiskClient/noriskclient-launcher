"use client";

import type React from "react";
import { useEffect, useRef } from "react";
import { toast as hotToast, Toaster as HotToaster } from "react-hot-toast";
import { gsap } from "gsap";
import { useThemeStore } from "../../store/useThemeStore";
import { getBorderRadiusClass, createRadiusStyle } from "./design-system";

export const toast = {
  success: (message: string) => {
    const id = hotToast.success(message);
    animateToast(id);
    return id;
  },
  error: (message: string) => {
    const id = hotToast.error(message);
    animateToast(id);
    return id;
  },
  loading: (message: string) => {
    const id = hotToast.loading(message);
    animateToast(id);
    return id;
  },
  custom: (message: string, icon?: React.ReactNode) => {
    const id = hotToast.custom((t) => (
      <div className="flex items-center gap-3">
        {icon && <div className="flex-shrink-0">{icon}</div>}
        <span>{message}</span>
      </div>
    ));
    animateToast(id);
    return id;
  },
  dismiss: (id?: string) => {
    hotToast.dismiss(id);
  },
};

function animateToast(id: string) {
  setTimeout(() => {
    const toastElement = document.getElementById(`toast-${id}`);
    if (toastElement) {
      gsap.fromTo(
        toastElement,
        {
          x: 50,
          opacity: 0,
          scale: 0.95,
        },
        {
          x: 0,
          opacity: 1,
          scale: 1,
          duration: 0.4,
          ease: "power2.out",
        },
      );
    }
  }, 10);
}

export function GlobalToaster() {
  const accentColor = useThemeStore((state) => state.accentColor);
  const borderRadius = useThemeStore((state) => state.borderRadius);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const toasterRef = useRef<HTMLDivElement>(null);
  
  const borderRadiusStyle = createRadiusStyle(borderRadius);
  const borderRadiusClass = getBorderRadiusClass(borderRadius);

  useEffect(() => {
    if (!isBackgroundAnimationEnabled) return;

    const toasts = document.querySelectorAll('[id^="toast-"]');
    toasts.forEach((toast) => {
      gsap.to(toast, {
        backgroundColor: `${accentColor.value}30`,
        borderColor: `${accentColor.value}80`,
        borderBottomColor: accentColor.value,
        duration: 0.2,
        ease: "power2.out",
      });
    });
  }, [accentColor, isBackgroundAnimationEnabled]);

  const getToastVariantStyles = (variant: string) => {
    switch (variant) {
      case "success":
        return {
          backgroundColor: "rgba(16, 185, 129, 0.3)",
          borderColor: "rgba(16, 185, 129, 0.8)",
          borderBottomColor: "#059669",
          color: "#d1fae5",
        };
      case "error":
        return {
          backgroundColor: "rgba(239, 68, 68, 0.3)",
          borderColor: "rgba(239, 68, 68, 0.8)",
          borderBottomColor: "#dc2626",
          color: "#fee2e2",
        };
      default:
        return {
          backgroundColor: `${accentColor.value}30`,
          borderColor: `${accentColor.value}80`,
          borderBottomColor: accentColor.value,
          color: "#ffffff",
        };
    }
  };

  return (
    <div ref={toasterRef}>      <HotToaster
        position="bottom-right"
        toastOptions={{
          className: `font-minecraft tracking-wider lowercase text-shadow-sm ${borderRadiusClass}`,
          style: {
            borderWidth: "1px",
            borderBottomWidth: "2px",
            borderStyle: "solid",
            boxShadow: "none",
            padding: "12px 20px",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            backgroundColor: `${accentColor.value}30`,
            borderColor: `${accentColor.value}80`,
            borderBottomColor: accentColor.value,
            color: "#ffffff",
            minWidth: "300px",
            transition: "all 0.2s ease",
            fontWeight: "500",
            ...borderRadiusStyle,
          },
          success: {
            style: {
              ...getToastVariantStyles("success"),
              boxShadow: "none",
              ...borderRadiusStyle,
            },
            iconTheme: {
              primary: "#059669",
              secondary: "#d1fae5",
            },
          },
          error: {
            style: {
              ...getToastVariantStyles("error"),
              boxShadow: "none",
              ...borderRadiusStyle,
            },
            iconTheme: {
              primary: "#dc2626",
              secondary: "#fee2e2",
            },
          },
          loading: {
            style: {
              ...getToastVariantStyles("default"),
              boxShadow: "none",
              ...borderRadiusStyle,
            },
            iconTheme: {
              primary: accentColor.value,
              secondary: "#ffffff",
            },
            duration: Infinity,
          },
          duration: 3000,
        }}
      />
    </div>
  );
}
