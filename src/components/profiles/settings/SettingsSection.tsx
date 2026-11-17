import type { CSSProperties, ReactNode } from "react";
import { Icon } from "@iconify/react";

import { cn } from "../../../lib/utils";
import { useThemeStore } from "../../../store/useThemeStore";

type Tone = "accent" | "plain" | "danger";

function toneStyle(tone: Tone, accent: string): CSSProperties | undefined {
  return tone === "accent" ? { borderColor: `${accent}99`, backgroundColor: `${accent}26` } : undefined;
}

const TONE_CLASSES: Record<Tone, string> = {
  accent: "text-white enabled:hover:brightness-125",
  plain: "border-white/10 bg-black/20 text-white/70 enabled:hover:border-white/25 enabled:hover:text-white",
  danger: "border-red-500/30 bg-red-500/10 text-red-300 enabled:hover:border-red-400/60 enabled:hover:text-red-200",
};

export function Chip({
  active,
  marked,
  disabled,
  accent,
  onClick,
  title,
  className,
  children,
}: {
  active: boolean;
  marked?: boolean;
  disabled?: boolean;
  accent: string;
  onClick: () => void;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const style: CSSProperties | undefined = active
    ? { backgroundColor: `${accent}33`, borderColor: accent }
    : marked
      ? { borderColor: `${accent}99` }
      : undefined;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "rounded-md border font-minecraft transition-colors",
        active ? "text-white" : TONE_CLASSES.plain,
        disabled && "cursor-not-allowed opacity-40",
        className,
      )}
      style={style}
    >
      {children}
    </button>
  );
}

export function SectionButton({
  icon,
  busy,
  disabled,
  tone = "plain",
  onClick,
  children,
}: {
  icon: string;
  busy?: boolean;
  disabled?: boolean;
  tone?: Tone;
  onClick: () => void;
  children: ReactNode;
}) {
  const accent = useThemeStore((state) => state.accentColor.value);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        "flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3 font-minecraft text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        TONE_CLASSES[tone],
      )}
      style={toneStyle(tone, accent)}
    >
      <Icon icon={busy ? "svg-spinners:ring-resize" : icon} className="h-4 w-4 shrink-0" />
      {children}
    </button>
  );
}

export function IconAction({
  icon,
  label,
  busy,
  disabled,
  tone = "plain",
  onClick,
}: {
  icon: string;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  tone?: Tone;
  onClick: () => void;
}) {
  const accent = useThemeStore((state) => state.accentColor.value);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        tone === "plain" ? "border-transparent text-white/60 enabled:hover:bg-white/10 enabled:hover:text-white" : TONE_CLASSES[tone],
      )}
      style={toneStyle(tone, accent)}
    >
      <Icon icon={busy ? "svg-spinners:ring-resize" : icon} className="h-4 w-4" />
    </button>
  );
}

export function Section({
  title,
  description,
  aside,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-black/20 p-4">
      <div className={cn("flex items-center justify-between gap-3", children !== undefined && "mb-3")}>
        <div className="min-w-0">
          <h3 className="font-smallcaps text-lg text-white">{title}</h3>
          {description && <p className="mt-0.5 font-minecraft text-xs text-white/50">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
