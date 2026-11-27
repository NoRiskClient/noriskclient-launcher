import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../../lib/utils";

export function WidgetMessage({ icon, text }: { icon: string; text?: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-white/40 font-minecraft text-sm">
      <Icon icon={icon} className="w-8 h-8" />
      {text}
    </div>
  );
}

export function WidgetLoading() {
  return <WidgetMessage icon="svg-spinners:ring-resize" />;
}

interface WidgetRowProps {
  media: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  launching?: boolean;
  launchable?: boolean;
  disabled?: boolean;
  tooltip?: string;
  onClick: () => void;
}

export function WidgetRow({
  media,
  title,
  subtitle,
  trailing,
  launching = false,
  launchable = false,
  disabled,
  tooltip,
  onClick,
}: WidgetRowProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className="group w-full flex items-center gap-2.5 px-1.5 py-1 rounded hover:bg-white/5 text-left transition-colors disabled:cursor-default"
    >
      <div className="relative w-8 h-8 shrink-0 rounded-sm overflow-hidden">
        {media}
        {launchable && (
          <div
            className={cn(
              "absolute inset-0 flex items-center justify-center bg-black/60 transition-opacity",
              launching ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <Icon icon={launching ? "svg-spinners:ring-resize" : "solar:play-bold"} className="w-4 h-4 text-white" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 font-minecraft normal-case">
        <div className="text-sm text-white truncate">{title}</div>
        {subtitle && <div className="text-[11px] text-white/40 truncate">{subtitle}</div>}
      </div>
      {trailing}
    </button>
  );
}

export function StatusDot({ color, className = "w-1.5 h-1.5" }: { color: string; className?: string }) {
  return (
    <span
      className={cn("shrink-0 rounded-full", className)}
      style={{ background: color, boxShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
    />
  );
}

export function PixelImage({ src, className }: { src: string; className?: string }) {
  return (
    <img src={src} alt="" draggable={false} className={cn("w-full h-full", className)} style={{ imageRendering: "pixelated" }} />
  );
}
