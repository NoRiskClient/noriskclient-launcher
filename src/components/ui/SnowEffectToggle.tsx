import { Icon } from "@iconify/react";
import { ToggleSwitch } from "./ToggleSwitch";
import { useSnowEffectStore } from "../../store/snow-effect-store";
import { SimpleTooltip } from "./Tooltip";
import { cn } from "../../lib/utils";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation();
  const { isEnabled, toggleSnowEffect } = useSnowEffectStore();

  if (variant === "compact") {
    return (
      <SimpleTooltip content={isEnabled ? t("snow_effect.on") : t("snow_effect.off")}>
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
        <span className="text-sm text-white/70 font-minecraft">
          {t("snow_effect.label")}
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

