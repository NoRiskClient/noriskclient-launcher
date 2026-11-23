import type { ReactNode } from "react";
import { useThemeStore } from "../../store/useThemeStore";

interface RailActionButtonProps {
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function RailActionButton({ disabled, onClick, children }: RailActionButtonProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full shrink-0 min-w-0 h-10 rounded-lg border-2 font-minecraft text-xs uppercase tracking-wider text-white transition-colors hover:brightness-125 disabled:opacity-50 disabled:hover:brightness-100"
      style={{ backgroundColor: `${accentColor.value}25`, borderColor: `${accentColor.value}90` }}
    >
      {children}
    </button>
  );
}
