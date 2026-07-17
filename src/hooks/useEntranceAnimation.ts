import { useEffect, useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { gsap } from "gsap";
import { useThemeStore } from "../store/useThemeStore";

export function useAnimationsEnabled(): boolean {
  const enabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
  const [prefersReduced, setPrefersReduced] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const onChange = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return enabled && !prefersReduced;
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
