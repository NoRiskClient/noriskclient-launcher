import { useEffect, useRef } from "react";
import { useThemeStore } from "../../store/useThemeStore";
import { useQualitySettingsStore } from "../../store/quality-settings-store";
import { useWindowFocus } from "../../hooks/useWindowFocus";

interface Particle {
  x: number;
  y: number;
  size: number;
  speedX: number;
  speedY: number;
  opacity: number;
  life: number;
  maxLife: number;
}

interface NebulaParticlesProps {
  particleCount?: number;
  opacity?: number;
  speed?: number;
  className?: string;
}

export function NebulaParticles({
  particleCount = 50,
  opacity = 0.3,
  speed = 1,
  className = "",
}: NebulaParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
  const { qualityLevel } = useQualitySettingsStore();
  const visibleRef = useRef<boolean>(true);
  const animationFrameIdRef = useRef<number>();
  const lastFrameTimeRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const isWindowFocused = useWindowFocus();
  
  // Animation timing state management
  const pausedTimeRef = useRef<number>(0);
  const totalPausedDurationRef = useRef<number>(0);
  const lastPauseStartRef = useRef<number>(0);
  const animationStartTimeRef = useRef<number>(0);
  const staticFrameRenderedRef = useRef<boolean>(false);
  const pausedParticleStatesRef = useRef<Particle[]>([]);
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
        visibleRef.current = entries[0].isIntersecting;
      },
      { threshold: 0.1 },
    );

    observer.observe(canvas);

    const qualityMultiplier =
      qualityLevel === "low" ? 0.3 : qualityLevel === "high" ? 0.8 : 0.5;
    const adjustedParticleCount = Math.floor(particleCount * qualityMultiplier);
    const adjustedSpeed = speed * qualityMultiplier;
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

      if (particlesRef.current.length === 0) {
        initParticles();
      }
    };

    const initParticles = () => {
      const { width, height } = canvas.getBoundingClientRect();
      particlesRef.current = [];

      for (let i = 0; i < adjustedParticleCount; i++) {
        particlesRef.current.push({
          x: Math.random() * width,
          y: Math.random() * height,
          size: Math.random() * 4 + 1,
          speedX: (Math.random() - 0.5) * 0.5 * adjustedSpeed,
          speedY: (Math.random() - 0.5) * 0.5 * adjustedSpeed,
          opacity: Math.random() * 0.5 + 0.1,
          life: 0,
          maxLife: Math.random() * 100 + 50,
        });
      }
    };

    const updateParticles = () => {
      const { width, height } = canvas.getBoundingClientRect();

      particlesRef.current.forEach((p) => {
        p.x += p.speedX;
        p.y += p.speedY;
        p.life += 1;

        if (
          p.x < 0 ||
          p.x > width ||
          p.y < 0 ||
          p.y > height ||
          p.life > p.maxLife
        ) {
          if (Math.random() > 0.5) {
            const edge = Math.floor(Math.random() * 4);
            if (edge === 0) {
              p.x = Math.random() * width;
              p.y = 0;
              p.speedY = Math.abs(p.speedY);
            } else if (edge === 1) {
              p.x = width;
              p.y = Math.random() * height;
              p.speedX = -Math.abs(p.speedX);
            } else if (edge === 2) {
              p.x = Math.random() * width;
              p.y = height;
              p.speedY = -Math.abs(p.speedY);
            } else {
              p.x = 0;
              p.y = Math.random() * height;
              p.speedX = Math.abs(p.speedX);
            }
          } else {
            p.x = Math.random() * width;
            p.y = Math.random() * height;
          }

          p.size = Math.random() * 4 + 1;
          p.opacity = Math.random() * 0.5 + 0.1;
          p.life = 0;
          p.maxLife = Math.random() * 100 + 50;
        }
      });
    };

    const renderParticles = (timestamp: number) => {
      // Only continue animation if should animate
      if (shouldAnimate) {
        animationFrameIdRef.current = requestAnimationFrame(renderParticles);
      }

      // Initialize animation start time on first run
      if (animationStartTimeRef.current === 0) {
        animationStartTimeRef.current = timestamp;
        lastFrameTimeRef.current = timestamp;
      }

      if (!visibleRef.current) return;
      
      // If animations are disabled, pause timing and render static frame only once
      if (!shouldAnimate) {
        // Record pause start time if not already paused
        if (lastPauseStartRef.current === 0) {
          lastPauseStartRef.current = timestamp;
          // Store current animation time when pausing
          const currentAnimationTime = timestamp - animationStartTimeRef.current - totalPausedDurationRef.current;
          pausedTimeRef.current = currentAnimationTime;
          // Deep copy current particle states for static frame
          pausedParticleStatesRef.current = JSON.parse(JSON.stringify(particlesRef.current));
        }
        
        if (!staticFrameRenderedRef.current) {
          const { width, height } = canvas.getBoundingClientRect();
          ctx.clearRect(0, 0, width, height);
          
          // Create/maintain static particles if they don't exist
          if (pausedParticleStatesRef.current.length === 0) {
            pausedParticleStatesRef.current = [];
            for (let i = 0; i < Math.floor(adjustedParticleCount * 0.5); i++) {
              pausedParticleStatesRef.current.push({
                x: Math.random() * width,
                y: Math.random() * height,
                size: Math.random() * 4 + 1,
                speedX: 0,
                speedY: 0,
                opacity: Math.random() * 0.5 + 0.3,
                life: 20,
                maxLife: 999999,
              });
            }
          }
          
          // Render static particles showing paused animation state
          pausedParticleStatesRef.current.forEach((p) => {
            const fadeIn = Math.min(1, p.life / 20);
            const fadeOut = Math.max(0, 1 - p.life / p.maxLife);
            const particleOpacity = p.opacity * fadeIn * fadeOut * opacity;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${particleOpacity})`;
            ctx.fill();

            if (qualityLevel !== "low") {
              const glowSize = p.size * (qualityLevel === "high" ? 2 : 1.5);
              const gradient = ctx.createRadialGradient(
                p.x,
                p.y,
                0,
                p.x,
                p.y,
                glowSize,
              );
              gradient.addColorStop(
                0,
                `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${particleOpacity * 0.5})`,
              );
              gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);

              ctx.beginPath();
              ctx.arc(p.x, p.y, glowSize, 0, Math.PI * 2);
              ctx.fillStyle = gradient;
              ctx.fill();
            }
          });
          
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
          lastFrameTimeRef.current = timestamp;
          justResumedRef.current = true; // Mark that we just resumed
          
          // Restore particle states from pause
          if (pausedParticleStatesRef.current.length > 0) {
            particlesRef.current = JSON.parse(JSON.stringify(pausedParticleStatesRef.current));
          }
        }
        
        staticFrameRenderedRef.current = false;
      }

      // Ensure particles are initialized for normal animation
      if (particlesRef.current.length === 0) {
        initParticles();
      }

      const elapsed = timestamp - lastFrameTimeRef.current;
      // Skip frame interval check on first frame after resume to prevent flicker
      if (!justResumedRef.current && elapsed < frameInterval) return;

      // Reset the just resumed flag after first frame
      if (justResumedRef.current) {
        justResumedRef.current = false;
      }

      lastFrameTimeRef.current = timestamp - (elapsed % frameInterval);

      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      updateParticles();

      particlesRef.current.forEach((p) => {
        const fadeIn = Math.min(1, p.life / 20);
        const fadeOut = Math.max(0, 1 - p.life / p.maxLife);
        const particleOpacity = p.opacity * fadeIn * fadeOut * opacity;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${particleOpacity})`;
        ctx.fill();

        if (qualityLevel !== "low") {
          const glowSize = p.size * (qualityLevel === "high" ? 2 : 1.5);
          const gradient = ctx.createRadialGradient(
            p.x,
            p.y,
            0,
            p.x,
            p.y,
            glowSize,
          );
          gradient.addColorStop(
            0,
            `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${particleOpacity * 0.5})`,
          );
          gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);

          ctx.beginPath();
          ctx.arc(p.x, p.y, glowSize, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
        }
      });
    };

    window.addEventListener("resize", resize);
    resize();
    
    // Start animation or render static frame
    animationFrameIdRef.current = requestAnimationFrame(renderParticles);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);

      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [accentColor.value, particleCount, opacity, speed, qualityLevel, shouldAnimate]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full ${className}`}
    />
  );
}
