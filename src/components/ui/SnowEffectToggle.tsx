"use client";

import { Icon } from "@iconify/react";
import { ToggleSwitch } from "./ToggleSwitch";
import { useSnowEffectStore } from "../../store/snow-effect-store";
import { SimpleTooltip } from "./Tooltip";
import { cn } from "../../lib/utils";

interface SnowEffectToggleProps {
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
  variant?: "compact" | "full";
}

export function SnowEffectToggle({
  showLabel = false,
  size = "sm",
  disabled = false,
  className,
  variant = "full",
}: SnowEffectToggleProps) {
  const { isEnabled, toggleSnowEffect } = useSnowEffectStore();

  if (variant === "compact") {
    return (
      <SimpleTooltip content={isEnabled ? "Snow Effect: On" : "Snow Effect: Off"}>
        <div className={cn("flex items-center gap-2", className)}>
          <Icon
            icon="solar:snowflake-bold"
            className={cn(
              "text-white/70 transition-colors",
              isEnabled && "text-white",
              size === "sm" ? "w-4 h-4" : size === "md" ? "w-5 h-5" : "w-6 h-6"
            )}
          />
          <ToggleSwitch
            checked={isEnabled}
            onChange={toggleSnowEffect}
            disabled={disabled}
            size={size}
          />
        </div>
      </SimpleTooltip>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {showLabel && (
        <span className="text-sm text-white/70 font-minecraft-ten">
          Snow Effect
        </span>
      )}
      <ToggleSwitch
        checked={isEnabled}
        onChange={toggleSnowEffect}
        disabled={disabled}
        size={size}
      />
    </div>
  );
}

