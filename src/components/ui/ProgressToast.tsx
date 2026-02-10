import { useThemeStore } from "../../store/useThemeStore";
import {
  getBorderRadiusClass,
  getToastBaseStyles,
  TOAST_BASE_CLASSES
} from "./design-system";

interface ProgressToastProps {
  message: string;
  progress: number; // 0-100
}

export function ProgressToast({ message, progress }: ProgressToastProps) {
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
          <svg
            className="animate-spin h-5 w-5 flex-shrink-0"
            style={{ color: accentColor.value }}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="flex-1">{message}</span>
          <span style={{ color: accentColor.value }}>
            {Math.round(clampedProgress)}%
          </span>
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
