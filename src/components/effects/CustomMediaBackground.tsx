import React, { useEffect, useRef, useState } from "react";
import { useBackgroundEffectStore } from "../../store/background-effect-store";
import { convertFileSrc } from "@tauri-apps/api/core";
import { logError } from "../../utils/logging-utils";

interface Props {
  activeTab: string;
}

export default function CustomMediaBackground({ activeTab }: Props) {
  const { customMediaUrl, customMediaType, customMediaOpacity, customMediaQuality, customMediaOnlyOnPlay } = useBackgroundEffectStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mediaError, setMediaError] = useState(false);

  const hiddenByTab = customMediaOnlyOnPlay && activeTab !== "play";

  useEffect(() => {
    setMediaError(false);
  }, [customMediaUrl]);

  useEffect(() => {
    if (customMediaType !== "video") return;

    const tryPlay = () => {
      if (videoRef.current && !hiddenByTab && document.hasFocus()) {
        videoRef.current.play().catch((e) => logError(`[CustomMediaBackground] video play failed: ${e}`));
      }
    };

    const handleBlur = () => {
      videoRef.current?.pause();
    };

    window.addEventListener("focus", tryPlay);
    window.addEventListener("blur", handleBlur);

    if (hiddenByTab) {
      videoRef.current?.pause();
    } else {
      tryPlay();
    }

    return () => {
      window.removeEventListener("focus", tryPlay);
      window.removeEventListener("blur", handleBlur);
    };
  }, [customMediaType, customMediaUrl, hiddenByTab]);

  if (!customMediaUrl || !customMediaType || mediaError) return null;

  const getQualityStyles = (): React.CSSProperties => {
    switch (customMediaQuality) {
      case "low":
        return {
          width: "50%",
          height: "50%",
          transform: "scale(2)",
          transformOrigin: "top left",
          imageRendering: "pixelated",
        };
      case "medium":
        return {
          width: "75%",
          height: "75%",
          transform: "scale(1.3333)",
          transformOrigin: "top left",
        };
      case "high":
      default:
        return {
          width: "100%",
          height: "100%",
        };
    }
  };

  const mediaStyles = getQualityStyles();

  const handleMediaError = () => {
    logError(`[CustomMediaBackground] failed to load media: ${customMediaUrl}`);
    setMediaError(true);
  };

  return (
    <div
      className="absolute inset-0 z-0 pointer-events-none"
      style={{
        opacity: customMediaOpacity,
        transition: "opacity 0.3s ease",
        display: hiddenByTab ? "none" : undefined,
      }}
    >
      {customMediaType === "video" ? (
        <video
          ref={videoRef}
          src={convertFileSrc(customMediaUrl)}
          autoPlay
          loop
          muted
          playsInline
          onError={handleMediaError}
          className="object-cover"
          style={mediaStyles}
        />
      ) : (
        <img
          src={convertFileSrc(customMediaUrl)}
          alt="Custom Background"
          onError={handleMediaError}
          className="object-cover"
          style={mediaStyles}
        />
      )}
    </div>
  );
}
