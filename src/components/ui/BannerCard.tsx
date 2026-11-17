import type { CSSProperties, ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";

interface BannerCardProps {
  children: ReactNode;
  /** Accent color for the bottom border / inner-glow. Defaults to theme accent. */
  color?: string;
  /** When set, renders a close button in the top-right corner. */
  onDismiss?: () => void;
  dismissTitle?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Shared launcher banner shell: translucent blurred card with the chunky
 * minecraft drop-shadow and an accent bottom-border. Used by the notice,
 * analytics and any future corner banners so the styling lives in one place.
 */
export function BannerCard({
  children,
  color,
  onDismiss,
  dismissTitle,
  className,
  style,
}: BannerCardProps) {
  const accentColor = useThemeStore((s) => s.accentColor);
  const c = color ?? accentColor.value;

  return (
    <div
      className={`relative rounded-lg p-4 cursor-default transition-all duration-200 ${className ?? ""}`}
      style={{
        backgroundColor: "rgba(0,0,0,0.2)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderBottom: `2px solid ${c}80`,
        boxShadow: `0 4px 0 rgba(0,0,0,0.3), 0 6px 12px rgba(0,0,0,0.35), inset 0 1px 0 ${c}1A`,
        ...style,
      }}
    >
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="absolute top-3 right-3 p-1 text-gray-400 hover:text-white transition-colors"
          title={dismissTitle}
        >
          <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
        </button>
      )}
      {children}
    </div>
  );
}
