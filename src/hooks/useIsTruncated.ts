import { useCallback, useEffect, useRef, useState } from "react";

export function useIsTruncated<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [truncated, setTruncated] = useState(false);

  const measure = useCallback(() => {
    const node = ref.current;
    if (node) setTruncated(node.scrollWidth > node.clientWidth + 1);
  }, []);

  useEffect(() => {
    measure();

    const node = ref.current;
    if (!node) return;

    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) measure();
    });

    if (typeof ResizeObserver === "undefined") {
      return () => {
        cancelled = true;
      };
    }

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [measure]);

  return { ref, truncated };
}
