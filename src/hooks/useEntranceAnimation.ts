import { useLayoutEffect } from "react";
import type { RefObject } from "react";
import { gsap } from "gsap";
import { useThemeStore } from "../store/useThemeStore";
import { useReducedMotionEnabled } from "../store/reduced-motion-store";

export function useAnimationsEnabled(): boolean {
  const enabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
  const reduced = useReducedMotionEnabled();
  return enabled && !reduced;
}

export function useEntranceAnimation<T extends HTMLElement>(
  ref: RefObject<T | null>,
  from: gsap.TweenVars,
  to: gsap.TweenVars,
  deps: unknown[] = [],
): void {
  const animationsEnabled = useAnimationsEnabled();

  useLayoutEffect(() => {
    if (!animationsEnabled || !ref.current) return;
    const tween = gsap.fromTo(ref.current, from, to);
    return () => {
      tween.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animationsEnabled, ...deps]);
}
