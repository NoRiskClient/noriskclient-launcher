import { useEffect, useState } from "react";

/** Below this width the rail would squeeze the chat. */
const RAIL_MIN_WINDOW_WIDTH = 1180;

export function useRailFits(): boolean {
  const [fits, setFits] = useState(() => window.innerWidth >= RAIL_MIN_WINDOW_WIDTH);
  useEffect(() => {
    const update = () => setFits(window.innerWidth >= RAIL_MIN_WINDOW_WIDTH);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return fits;
}
