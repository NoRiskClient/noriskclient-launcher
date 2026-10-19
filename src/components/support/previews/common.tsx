"use client";

import { Fragment, type ReactNode, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { cn } from "../../../lib/utils";
import { REDACTION_RE } from "./parse";

export function RedactedText({ text }: { text: string }) {
  const { t } = useTranslation();
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(REDACTION_RE)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <span
        title={t("support_request.preview.hidden_tooltip")}
        className="inline-block rounded px-1 mx-px bg-sky-500/20 border border-sky-400/40 text-sky-200 text-[0.85em] leading-tight align-baseline"
      >
        {match[0].replace(/[<>]/g, "")}
      </span>,
    );
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </>
  );
}

export function MonoBlock({ text }: { text: string }) {
  return (
    <pre className="rounded bg-black/50 border border-white/10 p-2 font-mono text-xs leading-relaxed text-white/80 whitespace-pre-wrap break-all select-text">
      <RedactedText text={text} />
    </pre>
  );
}

function FullText({ text }: { text: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 font-minecraft text-sm tracking-wide text-white/60 hover:text-white"
      >
        <Icon icon="solar:alt-arrow-down-linear" className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
        {t("support_request.preview.full_text")}
      </button>
      {open && <MonoBlock text={text} />}
    </div>
  );
}

export type BadgeTone = "neutral" | "good" | "warn" | "bad" | "info";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "border-white/15 bg-white/5 text-white/70",
  good: "border-green-500/40 bg-green-500/10 text-green-300",
  warn: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300",
  bad: "border-red-500/40 bg-red-500/10 text-red-300",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-300",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs border font-minecraft tracking-wide", BADGE_TONES[tone])}>
      {children}
    </span>
  );
}

export function CrashCard({ icon, title, detail, text, children }: { icon: string; title: string; detail: string | null; text: string; children?: ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border-2 p-3 space-y-2 border-red-500/40 bg-red-500/10">
        <div className="flex items-center gap-2">
          <Icon icon={icon} className="w-7 h-7 shrink-0 text-red-400" />
          <p className="font-minecraft text-lg text-white tracking-wide">{title}</p>
        </div>
        {detail && <p className="font-mono text-xs text-white/85 break-words">{detail}</p>}
      </div>
      {children}
      <FullText text={text} />
    </div>
  );
}

export function InfoGrid({ fields }: { fields: [icon: string, label: string, value: string | null][] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {fields
        .filter(([, , value]) => value)
        .map(([icon, label, value]) => (
          <div key={label} className="flex items-center gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2">
            <Icon icon={icon} className="w-6 h-6 shrink-0 text-white/70" />
            <div className="min-w-0">
              <div className="font-minecraft text-xs text-white/50 tracking-wide">{label}</div>
              <div className="font-minecraft text-sm text-white tracking-wide break-words">{value}</div>
            </div>
          </div>
        ))}
    </div>
  );
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1">
      {items.map((text) => (
        <li key={text} className="flex items-start gap-2 font-minecraft text-sm text-white/85 tracking-wide">
          <Icon icon="solar:check-circle-bold" className="w-4 h-4 shrink-0 mt-0.5 text-green-400" />
          {text}
        </li>
      ))}
    </ul>
  );
}
