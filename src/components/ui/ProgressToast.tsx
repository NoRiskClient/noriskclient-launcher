import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";
import {
  getBorderRadiusClass,
  getToastBaseStyles,
  TOAST_BASE_CLASSES
} from "./design-system";

interface ProgressToastProps {
  message: string;
  progress: number; // 0-100
  action?: React.ReactNode;
}

export function ProgressToast({ message, progress, action }: ProgressToastProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const borderRadius = useThemeStore((state) => state.borderRadius);
  const clampedProgress = Math.min(100, Math.max(0, progress));

  const borderRadiusClass = getBorderRadiusClass(borderRadius);
  const baseStyles = getToastBaseStyles({ accentColor: accentColor.value, borderRadius });

  return (
    <div
      className={`${TOAST_BASE_CLASSES} ${borderRadiusClass}`}
      style={baseStyles}
    >
      <div className="flex flex-col gap-2">
        {/* Same layout as loading toast: icon + message */}
        <div className="flex items-center gap-3">
          {/* Spinning loader icon like loading toast */}
          <Icon icon="svg-spinners:ring-resize" className="h-5 w-5 flex-shrink-0" style={{ color: accentColor.value }} />
          <span className="flex-1">{message}</span>
          <span style={{ color: accentColor.value }}>
            {Math.round(clampedProgress)}%
          </span>
          {action}
        </div>
        {/* Progress bar */}
        <div className="h-1 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full transition-all duration-300 ease-out rounded-full"
            style={{
              width: `${clampedProgress}%`,
              backgroundColor: accentColor.value,
            }}
          />
        </div>
      </div>
    </div>
  );
}
