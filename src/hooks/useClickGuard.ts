import { useEffect, useState } from "react";

const CLICK_GUARD_MS = 800;

export function useClickGuard(key: unknown = null, ms = CLICK_GUARD_MS): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
    const timer = window.setTimeout(() => setArmed(true), ms);
    return () => window.clearTimeout(timer);
  }, [key, ms]);
  return armed;
}
