import { useEffect, useRef, useState } from "react";

export function useDelayedTrue(
  active: boolean,
  delayMs = 500,
  minDurationMs = 0,
): boolean {
  const [delayed, setDelayed] = useState(false);
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    if (active) {
      if (delayed) return;
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setDelayed(true);
      }, delayMs);
      return () => clearTimeout(timer);
    }

    if (!delayed) return;

    const shown = shownAt.current;
    const remaining =
      shown === null ? 0 : minDurationMs - (Date.now() - shown);

    if (remaining <= 0) {
      shownAt.current = null;
      setDelayed(false);
      return;
    }

    const timer = setTimeout(() => {
      shownAt.current = null;
      setDelayed(false);
    }, remaining);
    return () => clearTimeout(timer);
  }, [active, delayed, delayMs, minDurationMs]);

  return delayed;
}
