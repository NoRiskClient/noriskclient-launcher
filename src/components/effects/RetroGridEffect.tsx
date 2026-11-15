import React from "react";
import { useThemeStore } from "../../store/useThemeStore";
import { useWindowFocus } from "../../hooks/useWindowFocus";

interface RetroGridEffectProps {
  className?: string;
  style?: React.CSSProperties;
  renderMode?: "top" | "bottom" | "both";
  perspective?: string;
  gridBackgroundColor?: string;
  customGridLineColor?: string;
  isAnimationEnabled?: boolean;
}

export function RetroGridEffect({
  className,
  style,
  renderMode = "both",
  perspective = "150px",
  gridBackgroundColor,
  customGridLineColor,
  isAnimationEnabled = true,
}: RetroGridEffectProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
  const isWindowFocused = useWindowFocus();
  const gridLineColor = customGridLineColor || `${accentColor.value}80`;
  
  // Animation should only run if both window is focused AND background animations are enabled (or explicitly enabled)
  const shouldAnimate = isWindowFocused && (isAnimationEnabled && isBackgroundAnimationEnabled);

  let effectiveGridBackgroundColor;
  if (gridBackgroundColor !== undefined) {
    effectiveGridBackgroundColor = gridBackgroundColor;
  } else {
    const r = parseInt(accentColor.value.slice(1, 3), 16);
    const g = parseInt(accentColor.value.slice(3, 5), 16);
    const b = parseInt(accentColor.value.slice(5, 7), 16);
    effectiveGridBackgroundColor = `rgba(${r}, ${g}, ${b}, 0)`;
  }

  const baseGridStyles: Omit<
    React.CSSProperties,
    "transform" | "top" | "bottom" | "animation"
  > = {
    width: "150%",
    height: "60%",
    backgroundImage: `
      linear-gradient(to right, ${gridLineColor} 1px, transparent 1px),
      linear-gradient(to bottom, ${gridLineColor} 1px, transparent 1px)
    `,
    backgroundSize: "40px 20px",
    position: "absolute",
    left: "-25%",
    pointerEvents: "none",
  };

  const bottomGridStyle: React.CSSProperties = {
    ...baseGridStyles,
    transform: "rotateX(140deg)",
    bottom: "-10%",
    animation: shouldAnimate ? "moveGrid 10s linear infinite" : "none",
    WebkitMaskImage:
      "linear-gradient(to top, rgba(0,0,0,1) 10%, rgba(0,0,0,0) 60%)",
    maskImage: "linear-gradient(to top, rgba(0,0,0,1) 10%, rgba(0,0,0,0) 60%)",
  };

  const topGridStyle: React.CSSProperties = {
    ...baseGridStyles,
    transform: "rotateX(-140deg)",
    top: "-10%",
    animation: shouldAnimate
      ? "moveGridReverse 10s linear infinite"
      : "none",
    WebkitMaskImage:
      "linear-gradient(to bottom, rgba(0,0,0,1) 10%, rgba(0,0,0,0) 60%)",
    maskImage:
      "linear-gradient(to bottom, rgba(0,0,0,1) 10%, rgba(0,0,0,0) 60%)",
  };

  const keyframes = `
    @keyframes moveGrid {
      0% { background-position-y: 0; }
      100% { background-position-y: -200px; }
    }
    @keyframes moveGridReverse {
      0% { background-position-y: -200px; }
      100% { background-position-y: 0; }
    }
  `;

  return (
    <div
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        backgroundColor: effectiveGridBackgroundColor,
        perspective: perspective,
        zIndex: 0,
        ...style,
      }}
    >
      <style>{keyframes}</style>
      {(renderMode === "top" || renderMode === "both") && (
        <div style={topGridStyle}></div>
      )}
      {(renderMode === "bottom" || renderMode === "both") && (
        <div style={bottomGridStyle}></div>
      )}
    </div>
  );
}
