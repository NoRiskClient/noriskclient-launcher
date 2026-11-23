import type React from "react";
import { useEffect, useRef } from "react";
import { toast as hotToast, Toaster as HotToaster } from "react-hot-toast";
import { gsap } from "gsap";
import { useThemeStore } from "../../store/useThemeStore";
import { usePlayerAvatar } from "../../hooks/usePlayerAvatar";
import { isMobile } from "../../lib/platform";
import { isNetworkError } from "../../lib/network";
import i18n from "../../i18n/i18n";
import {
  getBorderRadiusClass,
  createRadiusStyle,
  getToastVariantStyles,
  getToastBaseStyles,
  TOAST_BASE_CLASSES
} from "./design-system";

if (isMobile) {
  const showError = hotToast.error;
  hotToast.error = (message, options) =>
    isNetworkError(message)
      ? showError(i18n.t("common.offline_title"), { ...options, id: "offline" })
      : showError(message, options);
}

function PlayerToastContent({ message, uuid }: { message: string; uuid: string }) {
  const avatarUrl = usePlayerAvatar({ uuid, size: 32 });

  return (
    <div className="flex items-center gap-3">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="w-8 h-8 rounded flex-shrink-0"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <div className="w-8 h-8 rounded flex-shrink-0 bg-white/20 animate-pulse" />
      )}
      <span>{message}</span>
    </div>
  );
}

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
  info: (message: string) => {
    const id = hotToast(message);
    animateToast(id);
    return id;
  },
  player: (message: string, uuid: string) => {
    const id = hotToast(
      (t) => <PlayerToastContent message={message} uuid={uuid} />,
      { duration: 3000 }
    );
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
          ...(isMobile ? { y: -20 } : { x: 50 }),
          opacity: 0,
          scale: 0.95,
        },
        {
          x: 0,
          y: 0,
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
  const baseStyles = getToastBaseStyles({ accentColor: accentColor.value, borderRadius });

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

  return (
    <div ref={toasterRef}>
      <HotToaster
        position={isMobile ? "top-center" : "bottom-right"}
        containerStyle={isMobile ? { top: "calc(env(safe-area-inset-top) + 8px)" } : undefined}
        toastOptions={{
          className: `${TOAST_BASE_CLASSES} ${borderRadiusClass}${isMobile ? " !pointer-events-none" : ""}`,
          style: baseStyles,
          success: {
            style: {
              ...getToastVariantStyles("success", accentColor.value),
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
              ...getToastVariantStyles("error", accentColor.value),
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
              ...getToastVariantStyles("default", accentColor.value),
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
