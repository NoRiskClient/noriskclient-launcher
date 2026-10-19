"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../../lib/utils";
import { Badge, RedactedText } from "./common";
import { LOG_RENDER_CAP, analyzeLog, lineLevel } from "./parse";
import type { SupportPreviewProps } from "./types";

const HIGHLIGHT = ["ring-1", "ring-white/60"];

export function LogPreview({ item }: SupportPreviewProps) {
  const { t } = useTranslation();
  const viewerRef = useRef<HTMLDivElement>(null);
  const nextError = useRef(0);
  const highlight = useRef<{ el: HTMLElement; timer: number } | null>(null);
  const { lines, errors, firstErrors } = analyzeLog(item);
  const shown = lines.slice(0, LOG_RENDER_CAP);
  const gutter = String(shown.length).length;
  const targets = firstErrors.filter((i) => i < LOG_RENDER_CAP);

  const clearHighlight = () => {
    if (!highlight.current) return;
    window.clearTimeout(highlight.current.timer);
    highlight.current.el.classList.remove(...HIGHLIGHT);
    highlight.current = null;
  };
  useEffect(() => clearHighlight, []);

  const jumpToNextError = () => {
    if (targets.length === 0) return;
    const index = targets[nextError.current++ % targets.length];
    const el = viewerRef.current?.querySelector<HTMLElement>(`[data-line="${index}"]`);
    if (!el) return;
    clearHighlight();
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add(...HIGHLIGHT);
    highlight.current = { el, timer: window.setTimeout(clearHighlight, 1500) };
  };

  return (
    <div className="space-y-2">
      {errors > 0 ? (
        <button type="button" onClick={jumpToNextError} className="hover:brightness-125">
          <Badge tone="bad">{t("support_request.preview.log.errors", { count: errors })}</Badge>
        </button>
      ) : (
        <Badge tone="good">{t("support_request.summary.log_clean")}</Badge>
      )}

      <div ref={viewerRef} className="rounded bg-black/50 border border-white/10 py-1 font-mono text-xs leading-relaxed">
        {shown.map((line, i) => {
          const level = lineLevel(line);
          return (
            <div
              key={i}
              data-line={i}
              className={cn(
                "flex px-2 rounded-sm",
                level === "error" && "bg-red-500/10 text-red-200",
                level === "warn" && "bg-yellow-500/10 text-yellow-200",
                !level && "text-white/80",
              )}
            >
              <span className="select-none text-white/30 text-right shrink-0 mr-3" style={{ width: `${gutter}ch` }}>
                {i + 1}
              </span>
              <span className="whitespace-pre-wrap break-all min-w-0">
                <RedactedText text={line} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
