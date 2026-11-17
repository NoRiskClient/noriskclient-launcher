import { useEffect, useRef, useState } from "react";
import { useThemeStore } from "../../store/useThemeStore";
import { cn } from "../../lib/utils";
import { useQualitySettingsStore } from "../../store/quality-settings-store";
import { useWindowFocus } from "../../hooks/useWindowFocus";

interface MatrixRainEffectProps {
  opacity?: number;
  speed?: number;
  className?: string;
  forceEnable?: boolean;
}
export function MatrixRainEffect({
  opacity = 0.15,
  speed = 1,
  className,
  forceEnable = false,
}: MatrixRainEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const accentColor = useThemeStore((state) => state.accentColor);
  const staticBackground = useThemeStore((state) => state.staticBackground);
  const isBackgroundAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
  const { qualityLevel } = useQualitySettingsStore();
  const [isVisible, setIsVisible] = useState(true);
  const isWindowFocused = useWindowFocus();
  const isAnimating = forceEnable || !staticBackground;
  
  // Animation timing state management
  const pausedTimeRef = useRef<number>(0);
  const totalPausedDurationRef = useRef<number>(0);
  const lastPauseStartRef = useRef<number>(0);
  const animationStartTimeRef = useRef<number>(0);
  const staticFrameRenderedRef = useRef<boolean>(false);
  const pausedDropsStateRef = useRef<any[]>([]);
  const dropsRef = useRef<any[]>([]);
  
  // Animation should only run if both window is focused AND background animations are enabled (or forced)
  const shouldAnimate = isWindowFocused && (forceEnable || isBackgroundAnimationEnabled);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setIsVisible(entries[0].isIntersecting);
      },
      { threshold: 0.1 },
    );

    observer.observe(canvas);

    const FONT_SIZE = 16;
    const CHARACTERS =
      "ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const charactersArray = CHARACTERS.split("");
    const RAINDROP_SPAWN_RATE = 0.99;

    const qualityMultiplier =
      qualityLevel === "low" ? 0.3 : qualityLevel === "high" ? 0.8 : 0.5;
    const adjustedSpeed = speed * qualityMultiplier;
    const targetFps =
      qualityLevel === "low" ? 20 : qualityLevel === "high" ? 30 : 24;
    const frameInterval = 1000 / targetFps;

    let columns: number;
    let effectiveTime = 0; // This will be our continuous animation time
    let lastFrameTime = 0;

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

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      context.scale(dpr, dpr);

      columns = Math.floor(canvas.width / FONT_SIZE);
      
      // Only initialize drops if they don't exist yet
      if (dropsRef.current.length === 0) {
        dropsRef.current = Array(columns)
          .fill(null)
          .map((_, i) => ({
            x: i * FONT_SIZE,
            y: staticBackground
              ? Math.random() * canvas.height
              : Math.random() * -100,
            trail: Math.floor(
              Math.random() * ((canvas.height / FONT_SIZE) * 0.8) + 5,
            ),
            speed: (Math.random() * 1 + 0.5) * adjustedSpeed,
            ticksLeft: 0,
            brightness: Math.random() * 0.5 + 0.5,
            pulse: Math.random(),
            pulseFactor: Math.random() * 0.02 + 0.005,
          }));
      }
    };

    resize();
    window.addEventListener("resize", resize);
    context.font = `${FONT_SIZE}px monospace`;

    // Remove old blur/focus handlers as we now use useWindowFocus hook

    let animationFrameId: number;

    const draw = (timestamp: number) => {
      // Initialize animation start time on first run
      if (animationStartTimeRef.current === 0) {
        animationStartTimeRef.current = timestamp;
      }

      // Don't render if element is not visible
      if (!isVisible) {
        if (shouldAnimate) {
          animationFrameId = window.requestAnimationFrame(draw);
        }
        return;
      }
      
      // If animations are disabled, pause timing and render static frame
      if (!shouldAnimate) {
        // Record pause start time if not already paused
        if (lastPauseStartRef.current === 0) {
          lastPauseStartRef.current = timestamp;
          // Store current animation time when pausing
          const currentAnimationTime = timestamp - animationStartTimeRef.current - totalPausedDurationRef.current;
          pausedTimeRef.current = currentAnimationTime;
          // Save current drops state
          pausedDropsStateRef.current = JSON.parse(JSON.stringify(dropsRef.current));
        }
        
        if (!staticFrameRenderedRef.current) {
          const rgb = hexToRgb(accentColor.value);
          context.clearRect(0, 0, canvas.width, canvas.height);
          
          // Use paused time for consistent static frame
          const pausedEffectiveTime = pausedTimeRef.current;
          
          // Render static grid
          const gridSize = 40;
          const cols = Math.ceil(canvas.width / gridSize) + 1;
          const rows = Math.ceil(canvas.height / gridSize) + 1;

          for (let y = 0; y < rows; y++) {
            const posY = y * gridSize;
            const lineOpacity = opacity * 0.2 * (0.3 + 0.7 * Math.sin(y * 0.1 + pausedEffectiveTime * 0.001));
            context.beginPath();
            context.moveTo(0, posY);
            context.lineTo(canvas.width, posY);
            context.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${lineOpacity})`;
            context.lineWidth = 0.5;
            context.stroke();
          }

          for (let x = 0; x < cols; x++) {
            const posX = x * gridSize;
            const lineOpacity = opacity * 0.2 * (0.3 + 0.7 * Math.sin(x * 0.1 + pausedEffectiveTime * 0.001));
            context.beginPath();
            context.moveTo(posX, 0);
            context.lineTo(posX, canvas.height);
            context.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${lineOpacity})`;
            context.lineWidth = 0.5;
            context.stroke();
          }
          
          // Render matrix characters at paused state
          const renderDrops = pausedDropsStateRef.current.length > 0 ? pausedDropsStateRef.current : dropsRef.current;
          for (let i = 0; i < renderDrops.length; i++) {
            const drop = renderDrops[i];
            const headChar = charactersArray[Math.floor(Math.random() * charactersArray.length)];
            context.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${drop.brightness * opacity})`;
            context.fillText(headChar, drop.x, drop.y);

            // Render trail
            for (let j = 1; j < drop.trail; j++) {
              if (drop.y - j * FONT_SIZE < 0) continue;
              const trailChar = charactersArray[Math.floor(Math.random() * charactersArray.length)];
              const trailOpacity = drop.brightness * opacity * (1 - j / drop.trail);
              context.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${trailOpacity})`;
              context.fillText(trailChar, drop.x, drop.y - j * FONT_SIZE);
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
        if (lastPauseStartRef.current > 0) {
          const pauseDuration = timestamp - lastPauseStartRef.current;
          totalPausedDurationRef.current += pauseDuration;
          lastPauseStartRef.current = 0;
        }
        
        // Restore drops state if we have a saved state
        if (pausedDropsStateRef.current.length > 0) {
          dropsRef.current = JSON.parse(JSON.stringify(pausedDropsStateRef.current));
          // Clear the paused state since we've restored it
          pausedDropsStateRef.current = [];
        }
      }

      const elapsed = timestamp - lastFrameTime;
      if (elapsed < frameInterval) {
        animationFrameId = window.requestAnimationFrame(draw);
        return;
      }

      lastFrameTime = timestamp - (elapsed % frameInterval);

      // Calculate effective animation time (excluding paused periods)
      effectiveTime = timestamp - animationStartTimeRef.current - totalPausedDurationRef.current;

      const rgb = hexToRgb(accentColor.value);

      context.clearRect(0, 0, canvas.width, canvas.height);

      const gridSize = 40;
      const cols = Math.ceil(canvas.width / gridSize) + 1;
      const rows = Math.ceil(canvas.height / gridSize) + 1;

      for (let y = 0; y < rows; y++) {
        const posY = y * gridSize;
        const lineOpacity =
          opacity * 0.2 * (0.3 + 0.7 * Math.sin(y * 0.1 + effectiveTime * 0.001));

        context.beginPath();
        context.moveTo(0, posY);
        context.lineTo(canvas.width, posY);
        context.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${lineOpacity})`;
        context.lineWidth = 0.5;
        context.stroke();
      }

      for (let x = 0; x < cols; x++) {
        const posX = x * gridSize;
        const lineOpacity =
          opacity * 0.2 * (0.3 + 0.7 * Math.sin(x * 0.1 + effectiveTime * 0.001));

        context.beginPath();
        context.moveTo(posX, 0);
        context.lineTo(posX, canvas.height);
        context.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${lineOpacity})`;
        context.lineWidth = 0.5;
        context.stroke();
      }

      for (let i = 0; i < dropsRef.current.length; i++) {
        const drop = dropsRef.current[i];

        drop.pulse += drop.pulseFactor;
        if (drop.pulse > 1) drop.pulse = 0;

        const pulseBrightness = 0.5 + 0.5 * Math.sin(Math.PI * 2 * drop.pulse);
        const colorAlpha = drop.brightness * pulseBrightness * opacity * 2;

        const headChar =
          charactersArray[Math.floor(Math.random() * charactersArray.length)];
        context.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(1, colorAlpha * 3)})`;
        context.fillText(headChar, drop.x, drop.y);

        for (let j = 1; j < drop.trail; j++) {
          if (drop.y - j * FONT_SIZE < 0) continue;

          const trailChar =
            charactersArray[Math.floor(Math.random() * charactersArray.length)];
          const trailOpacity = colorAlpha * (1 - j / drop.trail);

          context.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${trailOpacity})`;
          context.fillText(trailChar, drop.x, drop.y - j * FONT_SIZE);
        }

        drop.y += drop.speed;

        if (drop.y > canvas.height && Math.random() > RAINDROP_SPAWN_RATE) {
          dropsRef.current[i] = {
            x: i * FONT_SIZE,
            y: staticBackground
              ? Math.random() * canvas.height
              : Math.random() * -100,
            trail: Math.floor(
              Math.random() * ((canvas.height / FONT_SIZE) * 0.8) + 5,
            ),
            speed: (Math.random() * 1 + 0.5) * adjustedSpeed,
            ticksLeft: 0,
            brightness: Math.random() * 0.5 + 0.5,
            pulse: Math.random(),
            pulseFactor: Math.random() * 0.02 + 0.005,
          };
        }
      }

      // Only continue animation if should animate
      if (shouldAnimate) {
        animationFrameId = window.requestAnimationFrame(draw);
      }
    };

    // Initial draw call
    animationFrameId = window.requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [
    opacity,
    speed,
    accentColor.value,
    qualityLevel,
    isAnimating,
    staticBackground,
    shouldAnimate,
    isVisible,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("absolute inset-0 w-full h-full", className)}
    />
  );
}
