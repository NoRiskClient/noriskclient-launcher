"use client";

import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router-dom";
import { useTranslation } from "react-i18next";

// Friendly fallback used by `errorElement` on the root route. Replaces the
// React Router default "Hey developer" screen so users can recover (reload /
// go home) and devs see a stack trace in non-prod builds.
export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const { title, message, stack } = useMemo(() => normalizeError(error, t), [error, t]);

  const isDev = import.meta.env.DEV;

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6 bg-neutral-950">
      <div className="w-full max-w-xl rounded-xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-rose-500/15 border border-rose-400/30 flex items-center justify-center">
            <Icon icon="solar:danger-triangle-bold" className="w-6 h-6 text-rose-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg text-white font-minecraft-ten normal-case">{title}</h1>
            <p className="mt-1 text-sm text-white/60 font-minecraft-ten normal-case break-words">
              {message}
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={() => { navigate("/play"); }}
            className="h-9 px-4 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/30 text-emerald-100 text-xs font-minecraft-ten uppercase tracking-wider flex items-center gap-1.5 transition-colors"
          >
            <Icon icon="solar:home-bold" className="w-4 h-4" />
            {t("errorBoundary.goHome")}
          </button>
          <button
            onClick={() => { window.location.reload(); }}
            className="h-9 px-4 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white text-xs font-minecraft-ten uppercase tracking-wider flex items-center gap-1.5 transition-colors"
          >
            <Icon icon="solar:refresh-bold" className="w-4 h-4" />
            {t("errorBoundary.reload")}
          </button>
          <button
            onClick={() => { navigate(-1); }}
            className="h-9 px-4 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white text-xs font-minecraft-ten uppercase tracking-wider flex items-center gap-1.5 transition-colors"
          >
            <Icon icon="solar:arrow-left-linear" className="w-4 h-4" />
            {t("errorBoundary.back")}
          </button>
        </div>

        {isDev && stack && (
          <div className="mt-5">
            <button
              onClick={() => setDetailsOpen(v => !v)}
              className="text-[11px] text-white/50 hover:text-white/80 font-minecraft-ten uppercase tracking-wider flex items-center gap-1"
            >
              <Icon
                icon="solar:alt-arrow-down-linear"
                className={`w-3 h-3 transition-transform ${detailsOpen ? "rotate-180" : ""}`}
              />
              {t("errorBoundary.details")}
            </button>
            {detailsOpen && (
              <pre className="mt-2 p-3 rounded-md bg-black/40 border border-white/5 text-[11px] text-rose-200/90 font-mono overflow-auto max-h-64 whitespace-pre-wrap break-words">
                {stack}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeError(
  error: unknown,
  t: (key: string, opts?: Record<string, unknown>) => string,
): { title: string; message: string; stack: string | null } {
  if (isRouteErrorResponse(error)) {
    return {
      title: t("errorBoundary.titleRoute", { status: error.status }),
      message: error.statusText || String(error.data ?? ""),
      stack: null,
    };
  }
  if (error instanceof Error) {
    return {
      title: t("errorBoundary.title"),
      message: error.message || t("errorBoundary.unknown"),
      stack: error.stack ?? null,
    };
  }
  return {
    title: t("errorBoundary.title"),
    message: typeof error === "string" ? error : t("errorBoundary.unknown"),
    stack: null,
  };
}
