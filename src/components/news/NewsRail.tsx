import { AdCard, useMainAdAvailable } from "../ads/AdCard";
import { NewsSection } from "./NewsSection";

export function NewsRail() {
  const showAd = useMainAdAvailable();
  return (
    <NewsSection
      className="shrink-0 border-l-2 border-white/40 bg-black/10 backdrop-blur-lg p-5 overflow-hidden flex flex-col relative z-10"
      ad={showAd ? <AdCard className="news-item" /> : null}
    />
  );
}
