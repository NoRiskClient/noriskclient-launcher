import { useEffect, useRef } from "react";
import { useThemeStore } from "../../store/useThemeStore";
import { useQualitySettingsStore } from "../../store/quality-settings-store";
import { useWindowFocus } from "../../hooks/useWindowFocus";

interface NebulaGridProps {
  opacity?: number;
  speed?: number;
  gridSize?: number;
  className?: string;
}

export function NebulaGrid({
  opacity = 0.15,
  speed = 1,
  gridSize = 30,
  className = "",
}: NebulaGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
  const { qualityLevel } = useQualitySettingsStore();
  const isWindowFocused = useWindowFocus();
  
  // Animation timing state management
  const pausedTimeRef = useRef<number>(0);
  const totalPausedDurationRef = useRef<number>(0);
  const lastPauseStartRef = useRef<number>(0);
  const animationStartTimeRef = useRef<number>(0);
  const staticFrameRenderedRef = useRef<boolean>(false);
  
  // Animation should only run if both window is focused AND background animations are enabled
  const shouldAnimate = isWindowFocused && isBackgroundAnimationEnabled;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let effectiveTime = 0;

    const qualityMultiplier =
      qualityLevel === "low" ? 0.5 : qualityLevel === "high" ? 1.5 : 1;
    const adjustedSpeed = speed * qualityMultiplier;
    const adjustedGridSize =
      qualityLevel === "low"
        ? gridSize * 1.5
        : qualityLevel === "high"
          ? gridSize * 0.7
          : gridSize;

    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? {
            r: Number.parseInt(result[1], 16),
            g: Number.parseInt(result[2], 16),
            b: Number.parseInt(result[3], 16),
          }
        : { r: 0, g: 0, b: 0 };
    };

    const rgb = hexToRgb(accentColor.value);

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };

    const renderGrid = (timestamp?: number) => {
      // Initialize animation start time on first run
      if (timestamp && animationStartTimeRef.current === 0) {
        animationStartTimeRef.current = timestamp;
      }

      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      
      // If animations are disabled, pause timing and render static frame only once
      if (!shouldAnimate) {
        // Record pause start time if not already paused
        if (timestamp && lastPauseStartRef.current === 0) {
          lastPauseStartRef.current = timestamp;
          // Store current animation time when pausing
          const currentAnimationTime = timestamp - animationStartTimeRef.current - totalPausedDurationRef.current;
          pausedTimeRef.current = currentAnimationTime;
        }
        
        if (!staticFrameRenderedRef.current) {
          const cellSize = adjustedGridSize;
          const cols = Math.ceil(width / cellSize) + 1;
          const rows = Math.ceil(height / cellSize) + 1;
          
          // Use paused time for static frame with animation state
          const pausedEffectiveTime = pausedTimeRef.current * 0.06; // Same scaling as active animation
          const offsetX = (pausedEffectiveTime * adjustedSpeed * 0.5) % cellSize;
          const offsetY = (pausedEffectiveTime * adjustedSpeed * 0.3) % cellSize;

          // Static grid with paused animation state
          for (let y = 0; y < rows; y++) {
            const posY = y * cellSize - offsetY;
            ctx.beginPath();
            ctx.moveTo(0, posY);
            ctx.lineTo(width, posY);
            const lineOpacity = opacity * (0.3 + 0.7 * Math.sin(y * 0.1 + pausedEffectiveTime * 0.001));
            ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${lineOpacity})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }

          for (let x = 0; x < cols; x++) {
            const posX = x * cellSize - offsetX;
            ctx.beginPath();
            ctx.moveTo(posX, 0);
            ctx.lineTo(posX, height);
            const lineOpacity = opacity * (0.3 + 0.7 * Math.sin(x * 0.1 + pausedEffectiveTime * 0.001));
            ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${lineOpacity})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }

          // Static dots with paused animation state
          for (let x = 0; x < cols; x++) {
            for (let y = 0; y < rows; y++) {
              const posX = x * cellSize - offsetX;
              const posY = y * cellSize - offsetY;
              const pulse = 0.5 + 0.5 * Math.sin(x * 0.5 + y * 0.5 + pausedEffectiveTime * 0.003 * adjustedSpeed);
              const dotSize = 2 * pulse;
              const dotOpacity = opacity * pulse;

              ctx.beginPath();
              ctx.arc(posX, posY, dotSize, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${dotOpacity})`;
              ctx.fill();
            }
          }
          
          staticFrameRenderedRef.current = true;
        }
        return;
      }

      // Reset static frame flag and handle resume when animations are enabled again
      if (staticFrameRenderedRef.current) {
        staticFrameRenderedRef.current = false;
        
        // Calculate total paused duration and reset pause tracking
        if (timestamp && lastPauseStartRef.current > 0) {
          const pauseDuration = timestamp - lastPauseStartRef.current;
          totalPausedDurationRef.current += pauseDuration;
          lastPauseStartRef.current = 0;
        }
      }

      // Calculate effective animation time (excluding paused periods)
      if (timestamp) {
        const rawEffectiveTime = timestamp - animationStartTimeRef.current - totalPausedDurationRef.current;
        // Convert milliseconds to frame-like increments for consistent animation speed
        effectiveTime = rawEffectiveTime * 0.06; // Approximately 60fps equivalent
      }

      const cellSize = adjustedGridSize;
      const cols = Math.ceil(width / cellSize) + 1;
      const rows = Math.ceil(height / cellSize) + 1;

      const offsetX = (effectiveTime * adjustedSpeed * 0.5) % cellSize;
      const offsetY = (effectiveTime * adjustedSpeed * 0.3) % cellSize;

      for (let y = 0; y < rows; y++) {
        const posY = y * cellSize - offsetY;

        ctx.beginPath();
        ctx.moveTo(0, posY);
        ctx.lineTo(width, posY);

        const lineOpacity =
          opacity * (0.3 + 0.7 * Math.sin(y * 0.1 + effectiveTime * 0.001));
        ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${lineOpacity})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      for (let x = 0; x < cols; x++) {
        const posX = x * cellSize - offsetX;

        ctx.beginPath();
        ctx.moveTo(posX, 0);
        ctx.lineTo(posX, height);

        const lineOpacity =
          opacity * (0.3 + 0.7 * Math.sin(x * 0.1 + effectiveTime * 0.001));
        ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${lineOpacity})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
          const posX = x * cellSize - offsetX;
          const posY = y * cellSize - offsetY;

          const pulse =
            0.5 +
            0.5 * Math.sin(x * 0.5 + y * 0.5 + effectiveTime * 0.003 * adjustedSpeed);
          const dotSize = 2 * pulse;
          const dotOpacity = opacity * pulse;

          ctx.beginPath();
          ctx.arc(posX, posY, dotSize, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${dotOpacity})`;
          ctx.fill();
        }
      }

      // Only continue animation if should animate
      if (shouldAnimate) {
        animationFrameId = requestAnimationFrame(renderGrid);
      }
    };

    window.addEventListener("resize", resize);
    resize();
    
    // Start animation or render static frame
    renderGrid();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [accentColor.value, opacity, speed, gridSize, qualityLevel, shouldAnimate]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full ${className}`}
    />
  );
}
