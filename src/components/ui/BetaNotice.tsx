"use client";

import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";

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
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const openingRef = useRef(false);
  const [isOpening, setIsOpening] = useState(false);

  const openFeedback = async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setIsOpening(true);
    try {
      await openExternalUrl(feedbackUrl);
    } catch {
      toast.error(t("common.open_link_failed"));
    } finally {
      openingRef.current = false;
      setIsOpening(false);
    }
  };

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
        onClick={openFeedback}
        disabled={isOpening}
        aria-busy={isOpening || undefined}
        className="ml-auto flex min-h-8 shrink-0 items-center gap-1.5 rounded-md bg-white/5 px-2 py-1.5 font-minecraft text-xs normal-case text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-60 disabled:cursor-wait focus-visible:bg-white/10 focus-visible:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80"
      >
        <Icon icon={isOpening ? "svg-spinners:ring-resize" : "ic:baseline-discord"} aria-hidden="true" className="h-3.5 w-3.5" />
        {feedbackLabel}
      </button>
    </div>
  );
}
