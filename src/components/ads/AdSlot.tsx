import { useEffect, useLayoutEffect, useRef } from "react";
import { coverAd, hideAd, setAdBounds, type AdRect } from "../../services/ads-service";
import { useLauncherAdsStore } from "../../store/launcher-ads-store";

const CHECK_INTERVAL_MS = 500;
const SAMPLE_POINTS = [0.05, 0.5, 0.95];

const visibleRect = (element: HTMLElement): AdRect | null => {
  if (document.visibilityState !== "visible") return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  if (rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight) {
    return null;
  }
  const room = element.parentElement?.getBoundingClientRect();
  if (room && (rect.left < room.left - 0.5 || rect.right > room.right + 0.5)) return null;
  const uncovered = SAMPLE_POINTS.every((fx) =>
    SAMPLE_POINTS.every((fy) => {
      const hit = document.elementFromPoint(rect.left + rect.width * fx, rect.top + rect.height * fy);
      return hit !== null && (element.contains(hit) || hit.closest("[data-ad-passthrough]") !== null);
    }),
  );
  if (!uncovered) return null;
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
};

interface AdSlotProps {
  slot: string;
  className?: string;
  onShownChange?: (shown: boolean) => void;
}

export function AdSlot({ slot, className, onShownChange }: AdSlotProps) {
  const active = useLauncherAdsStore((state) => state.active);
  const size = useLauncherAdsStore((state) => state.slots[slot]);
  const synced = useLauncherAdsStore((state) => state.synced);
  const shown = active && synced && !!size;
  const boxRef = useRef<HTMLDivElement>(null);
  const shownChange = useRef(onShownChange);
  shownChange.current = onShownChange;

  useEffect(() => {
    const box = boxRef.current;
    if (!shown || !box) return;

    let shownAt: string | null = null;
    let measuredAt: string | null = null;
    let frame = 0;

    const report = () => {
      frame = 0;
      const rect = visibleRect(box);
      const key = rect && `${rect.x},${rect.y},${rect.width},${rect.height}`;
      if (key === shownAt) return;
      if (!rect) {
        shownAt = null;
        measuredAt = null;
        shownChange.current?.(false);
        coverAd(slot).catch(() => {});
        return;
      }
      if (key !== measuredAt) {
        measuredAt = key;
        schedule();
        return;
      }
      shownAt = key;
      shownChange.current?.(true);
      setAdBounds(slot, rect).catch(() => {});
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(report);
    };

    const coverWatch = new MutationObserver(schedule);
    coverWatch.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(schedule, CHECK_INTERVAL_MS);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    document.addEventListener("visibilitychange", schedule);
    schedule();

    return () => {
      coverWatch.disconnect();
      window.clearInterval(timer);
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("visibilitychange", schedule);
      shownChange.current?.(false);
    };
  }, [shown, slot]);

  useLayoutEffect(() => {
    if (!shown) return;
    return () => {
      hideAd(slot).catch(() => {});
    };
  }, [shown, slot]);

  if (!shown) return null;

  return <div ref={boxRef} className={className} style={{ width: size.width, height: size.height }} />;
}
