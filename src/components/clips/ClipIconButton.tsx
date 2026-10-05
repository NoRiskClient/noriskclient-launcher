"use client";

import type { ButtonHTMLAttributes } from "react";
import { Icon } from "@iconify/react";

import { Tooltip } from "../ui/Tooltip";
import { cn } from "../../lib/utils";

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: string;
  label: string;
  tone?: "default" | "danger";
  tooltipPosition?: "top" | "bottom";
  withTooltip?: boolean;
}

export function ClipIconButton({
  icon,
  label,
  tone = "default",
  tooltipPosition = "bottom",
  withTooltip = true,
  className,
  disabled,
  ...rest
}: Props) {
  const button = (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={cn(
        "w-8 h-8 flex shrink-0 items-center justify-center rounded border border-white/10 bg-black/30 text-white/80 transition-colors duration-200 enabled:hover:border-white/20 enabled:hover:text-white",
        tone === "danger" ? "enabled:hover:bg-red-700/80" : "enabled:hover:bg-white/10",
        disabled && "cursor-not-allowed opacity-40",
        className,
      )}
      {...rest}
    >
      <Icon icon={icon} className="pointer-events-none w-4 h-4" />
    </button>
  );

  if (!withTooltip) return button;

  return (
    <Tooltip content={label} position={tooltipPosition}>
      {button}
    </Tooltip>
  );
}
