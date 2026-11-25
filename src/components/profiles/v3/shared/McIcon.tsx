import type React from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

interface McIconProps {
  src: string | null;
  fallback: string;
  onPlay?: () => void;
  playDisabled?: boolean;
  children?: React.ReactNode;
}

export function McIcon({ src, fallback, onPlay, playDisabled, children }: McIconProps) {
  const { t } = useTranslation();
  return (
    <div className="group/icon relative w-16 h-16 shrink-0 bg-black/40 flex items-center justify-center">
      {src ? (
        <img src={src} alt="" className="w-full h-full object-cover" style={{ imageRendering: "pixelated" }} />
      ) : (
        <Icon icon={fallback} className="w-8 h-8 text-white/30" />
      )}
      {children}
      {onPlay && (
        <button
          type="button"
          aria-label={t("worlds.play")}
          onClick={onPlay}
          disabled={playDisabled}
          className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 disabled:cursor-wait"
        >
          <Icon icon="solar:play-bold" className="w-8 h-8 text-white/80 group-hover/icon:text-white" />
        </button>
      )}
    </div>
  );
}
