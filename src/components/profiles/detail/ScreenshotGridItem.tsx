"use client";

import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../../lib/utils";
import type { ScreenshotInfo as ActualScreenshotInfo } from "../../../types/profile";
import { Icon } from "@iconify/react";

interface ScreenshotGridItemProps {
  screenshot: ActualScreenshotInfo;
  isBackgroundAnimationEnabled?: boolean;
  itemIndex?: number;
  onItemClick?: (screenshot: ActualScreenshotInfo) => void;
  previewSrc: string | null;
  isLoading: boolean;
  hasError: boolean;
}

const ScreenshotGridItemComponent: React.FC<ScreenshotGridItemProps> = ({
  screenshot,
  isBackgroundAnimationEnabled,
  itemIndex,
  onItemClick,
  previewSrc,
  isLoading,
  hasError,
}: ScreenshotGridItemProps) => {
  const { t } = useTranslation();
  const [isImageTagLoaded, setIsImageTagLoaded] = useState(false);
  const [imageTagError, setImageTagError] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsImageTagLoaded(false);
    setImageTagError(false);
  }, [previewSrc, isLoading, hasError]);

  const handleImageTagError = () => {
    setImageTagError(true);
    setIsImageTagLoaded(false);
  };

  const handleImageTagLoad = () => {
    setIsImageTagLoaded(true);
    setImageTagError(false);
  };

  const animationDelay = isBackgroundAnimationEnabled && typeof itemIndex === 'number' 
    ? `${itemIndex * 0.035}s` 
    : undefined;

  const handleItemClick = onItemClick ? () => onItemClick(screenshot) : undefined;

  return (
    <div
      ref={itemRef}
      onClick={handleItemClick}
      className={cn(
        "relative w-full rounded-md overflow-hidden cursor-pointer bg-black/20",
        "transition-opacity duration-300 ease-out",
        isBackgroundAnimationEnabled ? "animate-fadeInUpItem" : "",
      )}
      style={{
        aspectRatio: "16/9", // Force exact 16:9 ratio
        minWidth: "0", // Prevent flex/grid overflow
        animationDelay: animationDelay,
      }}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Icon icon="eos-icons:loading" className="w-8 h-8 text-white/70" />
        </div>
      )}

      {!isLoading && previewSrc && !hasError && !imageTagError && (
        <img
          src={previewSrc}
          alt={screenshot.filename}
          className={cn(
            "absolute inset-0 w-full h-full transition-opacity duration-700 ease-in-out",
            isImageTagLoaded ? "opacity-100" : "opacity-0"
          )}
          onError={handleImageTagError}
          onLoad={handleImageTagLoad}
          style={{
            objectFit: "cover",
            objectPosition: "center center",
          }}
        />
      )}

      {(!isLoading && (hasError || imageTagError)) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 p-2">
          <Icon icon="solar:gallery-remove-bold-duotone" className="w-8 h-8 text-red-400/80 mb-1" />
          <p className="text-red-400/90 text-xs font-minecraft text-center">{t('screenshots.preview_error')}</p>
        </div>
      )}

      {!isLoading && !previewSrc && !hasError && !imageTagError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 p-2">
          <Icon icon="solar:gallery-minimalistic-broken" className="w-8 h-8 text-white/50 mb-1" />
          <p className="text-white/60 text-xs font-minecraft text-center">{t('screenshots.no_preview')}</p>
        </div>
      )}
    </div>
  );
};

const propsAreEqual = (
  prevProps: ScreenshotGridItemProps,
  nextProps: ScreenshotGridItemProps
) => {
  return (
    prevProps.screenshot.path === nextProps.screenshot.path &&
    prevProps.previewSrc === nextProps.previewSrc &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.hasError === nextProps.hasError &&
    prevProps.isBackgroundAnimationEnabled === nextProps.isBackgroundAnimationEnabled &&
    prevProps.itemIndex === nextProps.itemIndex &&
    prevProps.onItemClick === nextProps.onItemClick // Important: This still relies on onItemClick being stable
  );
};

export const ScreenshotGridItem = React.memo(ScreenshotGridItemComponent, propsAreEqual); 