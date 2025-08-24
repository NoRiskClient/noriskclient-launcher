"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { gsap } from "gsap";
import { getBorderRadiusClass } from "./design-system";

interface StatusMessageProps {
  type: "success" | "error" | "warning" | "info";
  message: string;
  className?: string;
}

export function StatusMessage({
  type,
  message,
  className,
}: StatusMessageProps) {
  const messageRef = useRef<HTMLDivElement>(null);
  const radiusClass = getBorderRadiusClass();

  useEffect(() => {
    if (messageRef.current) {
      gsap.fromTo(
        messageRef.current,
        { opacity: 0, y: -10 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          ease: "back.out(1.7)",
        },
      );
    }
  }, []);

  const getTypeStyles = () => {
    switch (type) {
      case "success":
        return {
          bg: "bg-green-500/20",
          border: "border-green-500/40",
          text: "text-green-400",
          icon: "solar:check-circle-bold",
        };
      case "error":
        return {
          bg: "bg-red-500/20",
          border: "border-red-500/40",
          text: "text-red-400",
          icon: "solar:danger-circle-bold",
        };
      case "warning":
        return {
          bg: "bg-yellow-500/20",
          border: "border-yellow-500/40",
          text: "text-yellow-400",
          icon: "solar:danger-triangle-bold",
        };
      case "info":
        return {
          bg: "bg-blue-500/20",
          border: "border-blue-500/40",
          text: "text-blue-400",
          icon: "solar:info-circle-bold",
        };
    }
  };

  const styles = getTypeStyles();
  return (
    <div
      ref={messageRef}
      className={cn(
        "flex items-start p-4 mb-6 border-2 border-b-4",
        radiusClass,
        styles.bg,
        styles.border,
        styles.text,
        className,
      )}
      role="alert"
      aria-live="polite"
    >
      <Icon icon={styles.icon} className="w-6 h-6 mr-3 flex-shrink-0 mt-1" aria-hidden="true" />
      <div className="text-base font-minecraft-ten">{message}</div>
    </div>
  );
}
