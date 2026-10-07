"use client";

import type React from "react";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { toast as hotToast, Toaster as HotToaster, ToastBar, resolveValue, useToaster, type DefaultToastOptions, type Toast } from "react-hot-toast";
import { getTopDialogId, registerModalFeedbackHost, subscribeDialogLayer } from "./modal-focus";
import { useThemeStore } from "../../store/useThemeStore";
import { usePlayerAvatar } from "../../hooks/usePlayerAvatar";
import { useAnimationsEnabled } from "../../hooks/useEntranceAnimation";
import {
  getBorderRadiusClass,
  createRadiusStyle,
  getToastVariantStyles,
  getToastBaseStyles,
  TOAST_BASE_CLASSES
} from "./design-system";

function PlayerToastContent({ message, uuid }: { message: string; uuid: string }) {
  const avatarUrl = usePlayerAvatar({ uuid, size: 32 });
  const animationsEnabled = useAnimationsEnabled();

  return (
    <div className="flex min-w-0 items-center gap-3">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className="w-8 h-8 rounded flex-shrink-0"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <div className={`w-8 h-8 rounded flex-shrink-0 bg-white/20 ${animationsEnabled ? "animate-pulse" : ""}`} />
      )}
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{message}</span>
    </div>
  );
}

function CustomToastContent({ message, icon }: { message: string; icon?: React.ReactNode }) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const borderRadius = useThemeStore((state) => state.borderRadius);
  return (
    <div
      className={`${TOAST_BASE_CLASSES} ${getBorderRadiusClass(borderRadius)} flex min-w-0 items-center gap-3`}
      style={getToastBaseStyles({ accentColor: accentColor.value, borderRadius })}
    >
      {icon && <div className="flex-shrink-0">{icon}</div>}
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{message}</span>
    </div>
  );
}

function StaticToastIcon({ kind, accent }: { kind: "success" | "error" | "loading"; accent: string }) {
  return (
    <svg aria-hidden="true" data-toast-icon={kind} width="20" height="20" viewBox="0 0 20 20" className="shrink-0">
      {kind === "loading" ? (
        <>
          <circle cx="10" cy="10" r="8" fill="none" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="2" />
          <path d="M10 2a8 8 0 0 1 8 8" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="10" cy="10" r="10" fill={kind === "success" ? "#059669" : "#dc2626"} />
          <path d={kind === "success" ? "m5.5 10 3 3 6-6" : "m6.5 6.5 7 7m0-7-7 7"} fill="none" stroke={kind === "success" ? "#d1fae5" : "#fee2e2"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

export const toast = {
  success: (message: string) => {
    const id = hotToast.success(message);
    return id;
  },
  error: (message: string) => {
    const id = hotToast.error(message);
    return id;
  },
  loading: (message: string) => {
    const id = hotToast.loading(message);
    return id;
  },
  info: (message: string) => {
    const id = hotToast(message);
    return id;
  },
  player: (message: string, uuid: string) => {
    const id = hotToast(
      () => <PlayerToastContent message={message} uuid={uuid} />,
      { duration: 3000 }
    );
    return id;
  },
  custom: (message: string, icon?: React.ReactNode) => {
    const id = hotToast.custom(() => <CustomToastContent message={message} icon={icon} />);
    return id;
  },
  dismiss: (id?: string) => {
    hotToast.dismiss(id);
  },
};

function FeedbackToast({ notification, updateHeight }: { notification: Toast; updateHeight: (id: string, height: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Layout height, not the entrance animation's transformed rectangle.
    const measure = () => updateHeight(notification.id, node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [notification.id, updateHeight]);
  return (
    <div ref={ref} className="flex shrink-0 justify-end">
      {notification.type === "custom"
        ? resolveValue(notification.message, notification)
        : <ToastBar toast={notification} position="top-right" />}
    </div>
  );
}

function ModalFeedback({ dialogId, options }: { dialogId: string; options: DefaultToastOptions }) {
  const { t } = useTranslation();
  const { toasts, handlers } = useToaster(options);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const hovered = useRef(false), focused = useRef(false), paused = useRef(false);
  const updatePause = () => {
    const shouldPause = hovered.current || focused.current;
    if (shouldPause === paused.current) return;
    paused.current = shouldPause;
    if (shouldPause) handlersRef.current.startPause();
    else handlersRef.current.endPause();
  };
  useEffect(() => () => {
    if (paused.current) handlersRef.current.endPause();
  }, []);
  return (
    <div
      data-modal-owner={dialogId}
      data-modal-feedback-rail="true"
      className="custom-scrollbar focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      role="region"
      aria-label={t("common.feedback_messages")}
      tabIndex={toasts.length ? 0 : -1}
      onMouseEnter={() => { hovered.current = true; updatePause(); }}
      onMouseLeave={() => { hovered.current = false; updatePause(); }}
      onFocusCapture={() => { focused.current = true; updatePause(); }}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) { focused.current = false; updatePause(); }
      }}
    >
      <div className="flex flex-col gap-2">
        {toasts.map(notification => <FeedbackToast key={notification.id} notification={notification} updateHeight={handlers.updateHeight} />)}
      </div>
    </div>
  );
}

export function GlobalToaster() {
  const dialogId = useSyncExternalStore(subscribeDialogLayer, getTopDialogId, () => null);
  useLayoutEffect(registerModalFeedbackHost, []);
  const accentColor = useThemeStore((state) => state.accentColor);
  const borderRadius = useThemeStore((state) => state.borderRadius);
  const animationsEnabled = useAnimationsEnabled();

  const borderRadiusStyle = createRadiusStyle(borderRadius);
  const borderRadiusClass = getBorderRadiusClass(borderRadius);
  const baseStyles = getToastBaseStyles({ accentColor: accentColor.value, borderRadius });
  const options: DefaultToastOptions = {
          className: `${TOAST_BASE_CLASSES} ${borderRadiusClass}`,
          style: baseStyles,
          success: {
            icon: animationsEnabled ? undefined : <StaticToastIcon kind="success" accent={accentColor.value} />,
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
            icon: animationsEnabled ? undefined : <StaticToastIcon kind="error" accent={accentColor.value} />,
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
            icon: animationsEnabled ? undefined : <StaticToastIcon kind="loading" accent={accentColor.value} />,
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
  };
  return (
    <div data-modal-live-region data-motion-disabled={!animationsEnabled || undefined}>
      {dialogId
        ? <ModalFeedback dialogId={dialogId} options={options} />
        : <HotToaster position="bottom-right" toastOptions={options} />}
    </div>
  );
}
