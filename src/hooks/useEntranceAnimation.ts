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
    const node = ref.current;
    if (!node) return;
    // Revert owned inline styles when motion changes mid-tween. Merely killing
    // a fromTo can leave the element at opacity:0 / a partial transform.
    const context = gsap.context(() => {
      if (animationsEnabled) gsap.fromTo(node, from, to);
    }, node);
    return () => {
      context.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animationsEnabled, ...deps]);
}
