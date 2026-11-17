import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

export function holdPointer(event: ReactPointerEvent<Element>) {
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    return;
  }
}

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
    const handleEnd = () => end.current();
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
    window.addEventListener("lostpointercapture", handleEnd);
    window.addEventListener("blur", handleEnd);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      window.removeEventListener("lostpointercapture", handleEnd);
      window.removeEventListener("blur", handleEnd);
    };
  }, [active]);
}
