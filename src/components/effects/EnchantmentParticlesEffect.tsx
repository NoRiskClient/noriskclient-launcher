import { useEffect, useRef } from "react";
import { useThemeStore } from "../../store/useThemeStore";
import { useQualitySettingsStore } from "../../store/quality-settings-store";
import { useWindowFocus } from "../../hooks/useWindowFocus";

interface EnchantmentParticlesEffectProps {
  opacity?: number;
  className?: string;
  particleCount?: number;
  interactive?: boolean;
  speed?: number;
  forceEnable?: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  color: string;
  life: number;
  maxLife: number;
  character: string;
}

export function EnchantmentParticlesEffect({
  opacity = 0.5,
  className,
  particleCount = 150,
  interactive = true,
  speed = 1,
  forceEnable = false,
}: EnchantmentParticlesEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { accentColor, isBackgroundAnimationEnabled } = useThemeStore();
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });
  const animationFrameRef = useRef<number>();
  const lastFrameTimeRef = useRef<number>(0);
  const { qualityLevel } = useQualitySettingsStore();
  const visibleRef = useRef<boolean>(true);
  const isWindowFocused = useWindowFocus();
  const shouldRender = forceEnable || isBackgroundAnimationEnabled;
  
  // Animation timing state management
  const pausedTimeRef = useRef<number>(0);
  const totalPausedDurationRef = useRef<number>(0);
  const lastPauseStartRef = useRef<number>(0);
  const animationStartTimeRef = useRef<number>(0);
  const staticFrameRenderedRef = useRef<boolean>(false);
  const pausedParticleStatesRef = useRef<Particle[]>([]);
  const justResumedRef = useRef<boolean>(false);
  
  // Animation should only run if both window is focused AND background animations are enabled (or forced)
  const shouldAnimate = isWindowFocused && shouldRender;

  const hexToRgba = (hex: string, alpha: number) => {
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  useEffect(() => {
    if (!shouldRender) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const qualityMultiplier =
      qualityLevel === "low" ? 0.3 : qualityLevel === "high" ? 0.8 : 0.5;
    const adjustedParticleCount = Math.floor(particleCount * qualityMultiplier);
    const adjustedSpeed = speed * qualityMultiplier;
    const targetFps =
      qualityLevel === "low" ? 24 : qualityLevel === "high" ? 40 : 30;
    const frameInterval = 1000 / targetFps;

    const enchantmentChars = [
      "⍑",
      "⌇",
      "⎓",
      "⊣",
      "⊢",
      "⋮",
      "⫎",
      "⟒",
      "⟓",
      "⍊",
      "⌰",
      "⏃",
      "⏚",
      "⌿",
      "⍀",
      "⌇",
      "⏁",
      "⎍",
      "⎐",
      "⍙",
      "⍡",
      "⊬",
      "⋮",
      "⟊",
      "⟋",
    ];

    const observer = new IntersectionObserver(
      (entries) => {
        visibleRef.current = entries[0].isIntersecting;
      },
      { threshold: 0.1 },
    );

    observer.observe(canvas);

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      context.scale(dpr, dpr);

      if (particlesRef.current.length === 0) {
        initParticles();
      }
    };

    const initParticles = () => {
      particlesRef.current = [];
      for (let i = 0; i < adjustedParticleCount; i++) {
        createParticle(
          Math.random() * canvas.width,
          Math.random() * canvas.height,
          true,
        );
      }
    };

    const createParticle = (x: number, y: number, randomVelocity = false) => {
      const maxLife = Math.random() * 100 + 50;
      const char =
        enchantmentChars[Math.floor(Math.random() * enchantmentChars.length)];

      const particle: Particle = {
        x,
        y,
        vx: randomVelocity ? (Math.random() - 0.5) * 0.5 * adjustedSpeed : 0,
        vy: randomVelocity
          ? -Math.random() * 1 - 0.5 * adjustedSpeed
          : -1 - Math.random() * adjustedSpeed,
        size: Math.random() * 12 + 8,
        alpha: Math.random() * 0.6 + 0.2,
        color: hexToRgba(accentColor.value, 1),
        life: 0,
        maxLife,
        character: char,
      };

      particlesRef.current.push(particle);
      return particle;
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!interactive) return;
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      if (Math.random() > 0.8) {
        createParticle(mouseRef.current.x, mouseRef.current.y);
      }
    };

    const handleMouseLeave = () => {
      mouseRef.current = { x: null, y: null };
    };

    const animate = (timestamp: number) => {
      // Only continue animation loop if animations are enabled and window is focused
      if (shouldAnimate) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }

      // Initialize animation start time on first run
      if (animationStartTimeRef.current === 0) {
        animationStartTimeRef.current = timestamp;
        lastFrameTimeRef.current = timestamp;
      }

      // Don't render if element is not visible
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
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = `rgba(0, 0, 0, ${opacity / 2})`;
          context.fillRect(0, 0, canvas.width, canvas.height);
          
          // Create/maintain static particles if they don't exist
          if (pausedParticleStatesRef.current.length === 0) {
            pausedParticleStatesRef.current = [];
            for (let i = 0; i < Math.floor(adjustedParticleCount * 0.3); i++) {
              const char = enchantmentChars[Math.floor(Math.random() * enchantmentChars.length)];
              pausedParticleStatesRef.current.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: 0,
                vy: 0,
                size: Math.random() * 12 + 8,
                alpha: Math.random() * 0.6 + 0.2,
                color: hexToRgba(accentColor.value, 1),
                life: 20,
                maxLife: 999999,
                character: char,
              });
            }
          }
          
          // Render static particles showing paused animation state
          pausedParticleStatesRef.current.forEach((particle) => {
            const fadeInFactor = Math.min(1, particle.life / 20);
            const fadeOutFactor = Math.max(0, 1 - (particle.life - (particle.maxLife - 20)) / 20);
            const currentAlpha = particle.alpha * fadeInFactor * fadeOutFactor;

            context.font = `${particle.size}px "Times New Roman", serif`;
            context.fillStyle = hexToRgba(accentColor.value, currentAlpha * opacity);
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText(particle.character, particle.x, particle.y);
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

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = `rgba(0, 0, 0, ${opacity / 2})`;
      context.fillRect(0, 0, canvas.width, canvas.height);

      particlesRef.current = particlesRef.current.filter((particle) => {
        particle.life++;

        const fadeInFactor = Math.min(1, particle.life / 20);
        const fadeOutFactor = Math.max(
          0,
          1 - (particle.life - (particle.maxLife - 20)) / 20,
        );
        const currentAlpha = particle.alpha * fadeInFactor * fadeOutFactor;

        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.x += Math.sin(particle.life * 0.05) * 0.2 * adjustedSpeed;
        particle.vy *= 0.99;

        context.font = `${particle.size}px "Times New Roman", serif`;
        context.fillStyle = hexToRgba(
          accentColor.value,
          currentAlpha * opacity,
        );
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(particle.character, particle.x, particle.y);

        return particle.life < particle.maxLife;
      });

      if (Math.random() > 0.9) {
        createParticle(
          Math.random() * canvas.width,
          Math.random() * canvas.height,
        );
      }
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);

    // Start animation or render static frame
    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resizeCanvas);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [
    accentColor.value,
    opacity,
    particleCount,
    interactive,
    speed,
    qualityLevel,
    shouldRender,
    shouldAnimate,
  ]);



  if (!shouldRender) {
    return (
      <div
        className={className}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          zIndex: 0,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
        }}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
      }}
    />
  );
}
