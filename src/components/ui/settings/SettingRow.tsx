"use client";

import type { ReactNode } from "react";
import { cn } from "../../../lib/utils";
import { SimpleTooltip } from "../Tooltip";

interface SettingRowProps {
  label: ReactNode;
  description?: ReactNode;
  tooltip?: string;
  disabled?: boolean;
  vertical?: boolean;
  searchKeywords?: string[];
  className?: string;
  children: ReactNode;
}

export function SettingRow({
  label,
  description,
  tooltip,
  disabled,
  vertical,
  className,
  children,
}: SettingRowProps) {
  const labelNode = (
    <span className="font-minecraft text-base text-white">{label}</span>
  );

  return (
    <div
      className={cn(
        "flex gap-4 py-3 border-b border-white/10 last:border-b-0",
        vertical ? "flex-col" : "items-center justify-between",
        disabled && "opacity-50",
        className,
      )}
    >
      <div className="min-w-0">
        {tooltip ? <SimpleTooltip content={tooltip}>{labelNode}</SimpleTooltip> : labelNode}
        {description && (
          <div className="font-minecraft text-xs text-white/50 mt-0.5">
            {description}
          </div>
        )}
      </div>
      <div className={cn(vertical ? "w-full" : "flex-shrink-0")}>{children}</div>
    </div>
  );
}
