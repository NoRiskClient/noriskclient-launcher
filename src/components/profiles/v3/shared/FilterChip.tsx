import type React from "react";
import { useThemeStore } from "../../../../store/useThemeStore";

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  dot?: string;
  children: React.ReactNode;
}

export function FilterChip({
  active,
  onClick,
  dot,
  children,
}: FilterChipProps) {
  const accent = useThemeStore((s) => s.accentColor.value);
  return (
    <button
      onClick={onClick}
      className={`h-7 px-3 rounded-full border text-[11px] font-minecraft flex items-center gap-1.5 transition-colors ${
        active
          ? "text-white"
          : "bg-black/30 border-white/10 text-white/50 hover:text-white/80 hover:border-white/20"
      }`}
      style={
        active
          ? { backgroundColor: `${accent}33`, borderColor: `${accent}99` }
          : undefined
      }
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
      {children}
    </button>
  );
}
