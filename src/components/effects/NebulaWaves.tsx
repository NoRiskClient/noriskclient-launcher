import { useEffect, useRef, useState } from "react";
import { useThemeStore } from "../../store/useThemeStore";
import { useQualitySettingsStore } from "../../store/quality-settings-store";
import { useWindowFocus } from "../../hooks/useWindowFocus";

interface NebulaWavesProps {
  opacity?: number;
  speed?: number;
  className?: string;
  particleCount?: number;
}

export function NebulaWaves({
  opacity = 0.15,
  speed = 1,
  className = "",
  particleCount = 100,
}: NebulaWavesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
  const { qualityLevel } = useQualitySettingsStore();
  const [isVisible, setIsVisible] = useState(true);
  const isWindowFocused = useWindowFocus();
  
  // Animation timing state management
  const pausedTimeRef = useRef<number>(0);
  const totalPausedDurationRef = useRef<number>(0);
  const lastPauseStartRef = useRef<number>(0);
  const animationStartTimeRef = useRef<number>(0);
  const staticFrameRenderedRef = useRef<boolean>(false);
  const justResumedRef = useRef<boolean>(false);
  
  // Animation should only run if both window is focused AND background animations are enabled
  const shouldAnimate = isWindowFocused && isBackgroundAnimationEnabled;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setIsVisible(entries[0].isIntersecting);
      },
      { threshold: 0.1 },
    );

    observer.observe(canvas);

    let animationFrameId: number;
    let effectiveTime = 0;
    let lastFrameTime = 0;

    const qualityMultiplier =
      qualityLevel === "low" ? 0.3 : qualityLevel === "high" ? 0.8 : 0.5;
    const adjustedSpeed = speed * qualityMultiplier;
    const waveCount =
      qualityLevel === "low" ? 2 : qualityLevel === "high" ? 3 : 2;
    const targetFps =
      qualityLevel === "low" ? 20 : qualityLevel === "high" ? 30 : 24;
    const frameInterval = 1000 / targetFps;

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
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    const renderWaves = (timestamp: number) => {
      // Initialize animation start time on first run
      if (animationStartTimeRef.current === 0) {
        animationStartTimeRef.current = timestamp;
        lastFrameTime = timestamp;
      }

      // Don't render if element is not visible
      if (!isVisible) {
        if (shouldAnimate) {
          animationFrameId = requestAnimationFrame(renderWaves);
        }
        return;
      }
      
      // If animations are disabled, pause timing and render static frame only once
      if (!shouldAnimate) {
        // Record pause start time if not already paused
        if (lastPauseStartRef.current === 0) {
          lastPauseStartRef.current = timestamp;
          // Store current animation time when pausing
          const currentAnimationTime = timestamp - animationStartTimeRef.current - totalPausedDurationRef.current;
          pausedTimeRef.current = currentAnimationTime * 0.06; // Convert to frame-like increments
        }
        
        if (!staticFrameRenderedRef.current) {
          const { width, height } = canvas.getBoundingClientRect();
          ctx.clearRect(0, 0, width, height);
          
          // Render static waves with paused animation state
          const baseAmplitude = height / 6;
          const step = Math.max(5, Math.floor(width / 100));
          
          for (let i = 0; i < waveCount; i++) {
            const amplitude = baseAmplitude * (1 - i * 0.2);
            const frequency = 0.005 + i * 0.002;
            const speed = 0.0015 * (i + 1) * adjustedSpeed;
            const yOffset = height * 0.5 + i * 20;

            ctx.beginPath();
            const waveOpacity = opacity * (1 - i * 0.2);
            ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${waveOpacity})`;
            ctx.lineWidth = 2 - i * 0.5;

            for (let x = 0; x <= width; x += step) {
              const y = Math.sin(x * frequency + pausedTimeRef.current * speed) * amplitude + yOffset;
              if (x === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
            }
            ctx.stroke();
          }
          
          staticFrameRenderedRef.current = true;
        }
        return;
      }

      // Reset static frame flag and handle resume when animations are enabled again
      if (staticFrameRenderedRef.current) {
        // Calculate total paused duration and reset pause tracking BEFORE resetting flag
        if (lastPauseStartRef.current > 0) {
          const pauseDuration = timestamp - lastPauseStartRef.current;
          totalPausedDurationRef.current += pauseDuration;
          lastPauseStartRef.current = 0;
          lastFrameTime = timestamp;
          justResumedRef.current = true; // Mark that we just resumed
        }
        
        staticFrameRenderedRef.current = false;
      }

      // Calculate effective animation time (excluding paused periods)
      const rawEffectiveTime = timestamp - animationStartTimeRef.current - totalPausedDurationRef.current;
      effectiveTime = rawEffectiveTime * 0.06; // Convert milliseconds to frame-like increments

      const elapsed = timestamp - lastFrameTime;
      // Skip frame interval check on first frame after resume to prevent flicker
      if (!justResumedRef.current && elapsed < frameInterval) {
        if (shouldAnimate) {
          animationFrameId = requestAnimationFrame(renderWaves);
        }
        return;
      }

      // Reset the just resumed flag after first frame
      if (justResumedRef.current) {
        justResumedRef.current = false;
      }

      lastFrameTime = timestamp - (elapsed % frameInterval);

      const { width, height } = canvas.getBoundingClientRect();

      // Only clear rect if we're actually going to render new content
      ctx.clearRect(0, 0, width, height);

      const baseAmplitude = height / 6;
      const step = Math.max(5, Math.floor(width / 100));

      for (let i = 0; i < waveCount; i++) {
        const amplitude = baseAmplitude * (1 - i * 0.2);
        const frequency = 0.005 + i * 0.002;
        const speed = 0.0015 * (i + 1) * adjustedSpeed;
        const yOffset = height * 0.5 + i * 20;

        ctx.beginPath();

        const waveOpacity = opacity * (1 - i * 0.2);
        ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${waveOpacity})`;
        ctx.lineWidth = 2 - i * 0.5;

        for (let x = 0; x <= width; x += step) {
          const y =
            Math.sin(x * frequency + effectiveTime * speed) * amplitude + yOffset;
          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.stroke();
      }
      
      // Only continue animation if should animate
      if (shouldAnimate) {
        animationFrameId = requestAnimationFrame(renderWaves);
      }
    };

    window.addEventListener("resize", resize);
    resize();
    
    // Start animation or render static frame
    animationFrameId = requestAnimationFrame(renderWaves);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [accentColor.value, opacity, speed, qualityLevel, isVisible, shouldAnimate]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full ${className}`}
      style={{ opacity }}
    />
  );
}
