import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";

interface RailActionButtonProps {
  disabled?: boolean;
  icon?: string;
  onClick: () => void;
  children: ReactNode;
}

export function RailActionButton({ disabled, icon, onClick, children }: RailActionButtonProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full shrink-0 min-w-0 h-10 flex items-center justify-center gap-2 rounded-lg border-2 font-minecraft text-xs uppercase tracking-wider text-white transition-colors hover:brightness-125 disabled:opacity-50 disabled:hover:brightness-100"
      style={{ backgroundColor: `${accentColor.value}25`, borderColor: `${accentColor.value}90` }}
    >
      {icon && <Icon icon={icon} className="w-4 h-4 shrink-0" />}
      {children}
    </button>
  );
}
