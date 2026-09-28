import { useEffect, useLayoutEffect, useRef } from "react";

export function useWindowDrag<T>(
  active: T | null | false,
  onMove: (event: PointerEvent, active: T) => void,
  onEnd: () => void,
) {
  const move = useRef(onMove);
  const end = useRef(onEnd);

  useLayoutEffect(() => {
    move.current = onMove;
    end.current = onEnd;
  });

  useEffect(() => {
    if (!active) return;
    const handleMove = (event: PointerEvent) => move.current(event, active);
    const handleUp = () => end.current();
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [active]);
}
