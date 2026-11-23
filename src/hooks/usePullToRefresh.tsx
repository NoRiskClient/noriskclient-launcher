import { useEffect, useRef, useState, type RefObject } from "react";
import { Icon } from "@iconify/react";
import { isMobile } from "../lib/platform";
import { tapHaptic } from "../lib/haptics";

const THRESHOLD = 64;
const MAX_PULL = 96;

export function usePullToRefresh(
  ref: RefObject<HTMLElement>,
  onRefresh: () => Promise<unknown> | void,
) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const el = ref.current;
    if (!isMobile || !el) return;

    let startY: number | null = null;
    let startTarget: Node | null = null;
    let distance = 0;
    let busy = false;

    const atTop = () => {
      for (let n = startTarget; n && n !== el.parentNode; n = n.parentNode) {
        if (n instanceof HTMLElement && n.scrollTop > 0) return false;
      }
      return true;
    };

    const onStart = (e: TouchEvent) => {
      startTarget = e.target as Node;
      startY = !busy && atTop() ? e.touches[0].clientY : null;
      distance = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || !atTop()) {
        if (distance) {
          distance = 0;
          setPull(0);
        }
        return;
      }
      e.preventDefault();
      distance = Math.min(dy * 0.5, MAX_PULL);
      setPull(distance);
    };
    const onEnd = async () => {
      if (startY === null) return;
      startY = null;
      if (distance < THRESHOLD) {
        setPull(0);
        return;
      }
      busy = true;
      tapHaptic();
      setRefreshing(true);
      setPull(THRESHOLD);
      try {
        await onRefreshRef.current();
      } finally {
        busy = false;
        setRefreshing(false);
        setPull(0);
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ref]);

  return { pull, refreshing };
}

export function PullToRefreshIndicator({ pull, refreshing }: { pull: number; refreshing: boolean }) {
  if (!isMobile) return null;
  return (
    <div
      className="flex items-end justify-center overflow-hidden text-white/70"
      style={{
        height: pull,
        transition: refreshing || pull === 0 ? "height 200ms ease-out" : undefined,
      }}
    >
      <Icon
        icon="solar:refresh-bold"
        className={refreshing ? "w-6 h-6 mb-3 animate-spin" : "w-6 h-6 mb-3"}
        style={{
          opacity: Math.min(pull / THRESHOLD, 1),
          transform: refreshing ? undefined : `rotate(${pull * 4}deg)`,
        }}
      />
    </div>
  );
}
