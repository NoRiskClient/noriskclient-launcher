"use client";

import { Icon } from "@iconify/react";

import { openExternalUrl } from "../../services/tauri-service";
import { useThemeStore } from "../../store/useThemeStore";
import { cn } from "../../lib/utils";

interface BetaNoticeProps {
  tag: string;
  hint: string;
  feedbackLabel: string;
  feedbackUrl: string;
  className?: string;
}

export function BetaNotice({ tag, hint, feedbackLabel, feedbackUrl, className }: BetaNoticeProps) {
  const accentColor = useThemeStore((state) => state.accentColor);

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        className="rounded px-1.5 py-0.5 font-minecraft text-[10px] uppercase tracking-wider"
        style={{ color: accentColor.value, backgroundColor: `${accentColor.value}1f` }}
      >
        {tag}
      </span>

      <span className="truncate font-minecraft text-xs normal-case text-white/40">{hint}</span>

      <button
        type="button"
        onMouseDown={(event) => {
          event.preventDefault();
          openExternalUrl(feedbackUrl);
        }}
        className="ml-auto flex shrink-0 items-center gap-1.5 font-minecraft text-xs normal-case text-white/35 transition-colors hover:text-white/80"
      >
        <Icon icon="ic:baseline-discord" className="h-3.5 w-3.5" />
        {feedbackLabel}
      </button>
    </div>
  );
}
