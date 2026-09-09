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
}

export function ClipIconButton({
  icon,
  label,
  tone = "default",
  tooltipPosition = "bottom",
  className,
  disabled,
  ...rest
}: Props) {
  return (
    <Tooltip content={label} position={tooltipPosition}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        className={cn(
          "w-8 h-8 flex items-center justify-center rounded bg-black/30 text-white/70 hover:text-white border border-white/10 hover:border-white/20 transition-all duration-200",
          tone === "danger" ? "hover:bg-red-700/80" : "hover:bg-black/50",
          disabled && "cursor-not-allowed opacity-40",
          className,
        )}
        {...rest}
      >
        <Icon icon={icon} className="w-4 h-4" />
      </button>
    </Tooltip>
  );
}
