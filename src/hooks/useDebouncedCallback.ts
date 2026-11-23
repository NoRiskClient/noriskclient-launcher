import { useCallback, useEffect, useRef } from "react";

export function useDebouncedCallback<A extends unknown[]>(callback: (...args: A) => void, delay: number) {
  const latest = useRef(callback);
  const pending = useRef<A | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  latest.current = callback;

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const args = pending.current;
    pending.current = null;
    if (args) latest.current(...args);
  }, []);

  useEffect(() => flush, [flush]);

  return useCallback(
    (...args: A) => {
      pending.current = args;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [delay, flush],
  );
}
