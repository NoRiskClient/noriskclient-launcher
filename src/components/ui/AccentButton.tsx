import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";

interface AccentButtonProps {
  disabled?: boolean;
  icon?: string;
  title?: string;
  className?: string;
  onClick: () => void;
  children?: ReactNode;
}

export function AccentButton({ disabled, icon, title, className, onClick, children }: AccentButtonProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cn(
        "w-full shrink-0 min-w-0 h-10 px-4 flex items-center justify-center gap-2 rounded-lg border-2 font-minecraft text-sm normal-case text-white transition-colors hover:brightness-125 disabled:opacity-50 disabled:hover:brightness-100",
        className,
      )}
      style={{ backgroundColor: `${accentColor.value}25`, borderColor: `${accentColor.value}90` }}
    >
      {icon && <Icon icon={icon} className="w-4 h-4 shrink-0" />}
      {children}
    </button>
  );
}
