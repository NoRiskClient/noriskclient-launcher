import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useThemeStore } from "../../store/useThemeStore";
import { AdCaption, AdFrame, MAIN_AD_SLOT, useAdSize } from "./AdCard";

const RAIL_BORDER = 2;
const AD_PADDING = 12;
const RAIL_GAP = 12;
const AD_RAIL_WIDTH = 300 + AD_PADDING * 2 + RAIL_BORDER * 2;

interface RailSlot {
  target: HTMLElement | null;
  headerTarget: HTMLElement | null;
  setPanels: (update: (count: number) => number) => void;
}

const RailContext = createContext<RailSlot>({ target: null, headerTarget: null, setPanels: () => {} });

export function AdRailLayout({ children }: { children: ReactNode }) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const railAd = useAdSize(MAIN_AD_SLOT);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null);
  const [panels, setPanels] = useState(0);
  const visible = !!railAd || panels > 0;

  return (
    <RailContext.Provider value={{ target, headerTarget, setPanels }}>
      <div className="h-full flex flex-col">
        <div ref={setHeaderTarget} className="shrink-0" />
        <div
          data-page-area
          className="relative flex-1 min-h-0"
          style={{ ["--ad-rail-width" as string]: visible ? `${AD_RAIL_WIDTH + RAIL_GAP}px` : "0px" }}
        >
          <div className="absolute inset-0 overflow-hidden" style={{ paddingRight: "var(--ad-rail-width)" }}>
            {children}
          </div>
          <aside
            className="absolute top-0 right-0 bottom-0 z-20 py-3"
            style={{ display: visible ? undefined : "none", paddingRight: RAIL_GAP }}
          >
            <div
              className="h-full flex flex-col rounded-lg overflow-hidden bg-black/70 backdrop-blur-lg"
              style={{ width: AD_RAIL_WIDTH, border: `${RAIL_BORDER}px solid ${accentColor.value}40` }}
            >
              <div ref={setTarget} className="flex-1 min-h-0 flex flex-col gap-2 p-2.5" />
              {railAd && (
                <div className="shrink-0 flex flex-col gap-2 p-3 pt-0">
                  <AdFrame slot={MAIN_AD_SLOT} size={railAd} />
                  <AdCaption />
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </RailContext.Provider>
  );
}

export function RailPanel({ children }: { children: ReactNode }) {
  const { target, setPanels } = useContext(RailContext);

  useEffect(() => {
    setPanels((count) => count + 1);
    return () => setPanels((count) => count - 1);
  }, [setPanels]);

  return target ? createPortal(children, target) : null;
}

export function RailHeader({ children }: { children: ReactNode }) {
  const { headerTarget } = useContext(RailContext);
  return headerTarget ? createPortal(children, headerTarget) : null;
}
