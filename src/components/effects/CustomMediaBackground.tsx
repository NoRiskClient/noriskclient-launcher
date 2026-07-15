import React, { useEffect, useRef } from "react";
import { useBackgroundEffectStore } from "../../store/background-effect-store";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Window } from "@tauri-apps/api/window";

interface Props {
  activeTab: string;
}

export default function CustomMediaBackground({ activeTab }: Props) {
  const { customMediaUrl, customMediaType, customMediaOpacity, customMediaQuality, customMediaOnlyOnPlay } = useBackgroundEffectStore();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (customMediaType !== "video") return;

    const handleFocus = () => {
      if (videoRef.current) {
        videoRef.current.play().catch(e => console.error("Video play error:", e));
      }
    };

    const handleBlur = () => {
      if (videoRef.current) {
        videoRef.current.pause();
      }
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    // Ensure it plays when mounted or url changes, if window is focused
    if (document.hasFocus() && videoRef.current) {
      videoRef.current.play().catch(e => console.error("Video play error:", e));
    }

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, [customMediaType, customMediaUrl]);

  if (!customMediaUrl || !customMediaType) return null;
  if (customMediaOnlyOnPlay && activeTab !== "play") return null;

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

  return (
    <div 
      className="absolute inset-0 z-0 pointer-events-none" 
      style={{ opacity: customMediaOpacity, transition: "opacity 0.3s ease" }}
    >
      {customMediaType === "video" ? (
        <video
          ref={videoRef}
          src={convertFileSrc(customMediaUrl)}
          autoPlay
          loop
          muted
          playsInline
          className="object-cover"
          style={mediaStyles}
        />
      ) : (
        <img
          src={convertFileSrc(customMediaUrl)}
          alt="Custom Background"
          className="object-cover"
          style={mediaStyles}
        />
      )}
    </div>
  );
}
