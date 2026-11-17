import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useInView } from "react-intersection-observer";
import { fetchLauncherNews } from "../../services/nrc-service";
import { openExternalUrl } from "../../services/tauri-service";
import { cn } from "../../lib/utils";
import { NewsCard } from "../ui/NewsCard";
import { useThemeStore } from "../../store/useThemeStore";
import { NEWS_PAGE_SIZE, useNewsStore } from "../../store/useNewsStore";
import { newsLocale } from "../../types/launcherNews";

interface NewsSectionProps {
  className?: string;
}

export function NewsSection({ className }: NewsSectionProps) {
  const { t } = useTranslation();
  const newsRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(0);
  const accentColor = useThemeStore((state) => state.accentColor);
  const newsSectionWidth = useThemeStore((state) => state.newsSectionWidth);
  const setNewsSectionWidth = useThemeStore((state) => state.setNewsSectionWidth);
  const locale = newsLocale(useThemeStore((state) => state.language));

  const { items, page, totalPages, error, setFirstPage, appendPage, setError } = useNewsStore();
  const [loadingMore, setLoadingMore] = useState(false);
  // No automatic retry: it would loop while the trigger stays in view.
  const [moreFailed, setMoreFailed] = useState(false);

  const fadeStrength = 90;

  const loadNews = useCallback(async () => {
    try {
      setFirstPage(await fetchLauncherNews(1, NEWS_PAGE_SIZE));
      setError(null);
    } catch (err) {
      console.error("[NewsSection] Error fetching news:", err);
      setError(err instanceof Error ? err.message : "An unknown error occurred");
    }
  }, [setError, setFirstPage]);

  const loadMore = useCallback(async () => {
    if (loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      appendPage(await fetchLauncherNews(page + 1, NEWS_PAGE_SIZE));
    } catch (err) {
      console.error("[NewsSection] Error fetching more news:", err);
      setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [appendPage, loadingMore, page, totalPages]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    setIsResizing(true);
    setStartX(e.clientX);
    setStartWidth(newsSectionWidth);
    e.preventDefault();
  }, [newsSectionWidth]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const deltaX = e.clientX - startX;
    const newWidth = Math.max(120, Math.min(500, startWidth - deltaX));
    setNewsSectionWidth(newWidth);
  }, [isResizing, startX, startWidth, setNewsSectionWidth]);

  useEffect(() => {
    loadNews();
  }, [loadNews]);

  useEffect(() => {
    const interval = setInterval(() => {
      console.log("[NewsSection] Auto-refreshing news...");
      loadNews();
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [loadNews]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleResizeMove);
      document.addEventListener("mouseup", handleResizeEnd);
    }

    return () => {
      document.removeEventListener("mousemove", handleResizeMove);
      document.removeEventListener("mouseup", handleResizeEnd);
    };
  }, [isResizing, handleResizeMove, handleResizeEnd]);


  const renderContent = () => {
    if (error && items.length === 0) {
      return (
        <div className="text-center p-2">
          <Icon
            icon="pixel:exclamation-triangle-solid"
            className="w-8 h-8 text-red-400 mx-auto mb-2"
          />
          <p className="text-red-400">{t('common.error')}: {error}</p>
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className="text-center p-2">
          <Icon
            icon="pixel:newspaper-solid"
            className="w-8 h-8 text-white/50 mx-auto mb-2"
          />
          <p className="text-white/70">{t('news.no_news_available')}</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col space-y-1 w-full">
        {items.map((item) => {
          const displayTitle = item.title[locale] || t('news.item');
          const imageUrl = item.thumbnailUrl || "/placeholder.svg";
          const postUrl = item.url?.[locale] || "#";

          return (
            <div key={item.id} className="news-item w-full flex flex-col">
              <p
                className="font-smallcaps text-base text-white/70 truncate"
                title={displayTitle}
              >
                {displayTitle}
              </p>
              <div className="relative w-full pt-[56.25%]">
                <NewsCard
                  id={`news-item-card-${item.id}`}
                  className={cn(
                    "absolute top-0 left-0 w-full h-full news-item-card",
                    postUrl !== "#" && "cursor-pointer",
                  )}
                  title={displayTitle}
                  imageUrl={imageUrl}
                  postUrl={postUrl}
                  onClick={() => {
                    if (postUrl !== "#") {
                      openExternalUrl(postUrl).catch((err) =>
                        console.error("Failed to open URL:", err),
                      );
                    }
                  }}
                />
              </div>
            </div>
          );
        })}
        {page < totalPages &&
          (moreFailed ? (
            <button
              type="button"
              className="self-center my-2 px-3 py-1 text-sm font-smallcaps text-white/70 hover:text-white"
              onClick={() => void loadMore()}
            >
              {t('common.try_again')}
            </button>
          ) : (
            <LoadMore loading={loadingMore} onVisible={loadMore} />
          ))}
      </div>
    );
  };

  return (
    <div
      ref={newsRef}
      className={cn("h-full flex flex-col !p-3 z-0 relative", className)}
      style={{
        width: `${newsSectionWidth}px`,
        borderLeft: `2px solid ${accentColor.value}60`,
        borderRight: `2px solid ${accentColor.value}60`,
        boxShadow: `0 0 15px ${accentColor.value}30 inset`,
      }}
    >
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize z-10",
          isResizing && "bg-white/20"
        )}
        style={{
          backgroundColor: isResizing ? `${accentColor.value}40` : 'transparent',
        }}
        onMouseDown={handleResizeStart}
      />
      <div className="pb-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon icon="pixel:newspaper-solid" className="w-7 h-7 text-white" />
            <h2 className="text-base font-smallcaps text-white">{t('news.title')}</h2>
          </div>
        </div>
        <hr
          className="mt-2 border-t-2"
          style={{ borderColor: `${accentColor.value}40` }}
        />
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar relative">
        {renderContent()}

        <div
          className="sticky bottom-0 left-0 right-0 h-20 pointer-events-none z-10"
          style={{
            background: `linear-gradient(to top,
              rgba(0, 0, 0, ${(fadeStrength * 0.01)}) 0%,
              rgba(0, 0, 0, ${(fadeStrength * 0.0075)}) 25%,
              rgba(0, 0, 0, ${(fadeStrength * 0.005)}) 50%,
              rgba(0, 0, 0, ${(fadeStrength * 0.0025)}) 75%,
              rgba(0, 0, 0, 0) 100%)`,
          }}
        />
      </div>
    </div>
  );
}

function LoadMore({ loading, onVisible }: { loading: boolean; onVisible: () => void }) {
  const { ref, inView } = useInView({ rootMargin: "300px" });

  useEffect(() => {
    if (inView && !loading) onVisible();
  }, [inView, loading, onVisible]);

  return (
    <div ref={ref} className="flex justify-center py-3">
      {loading && <Icon icon="eos-icons:loading" className="w-5 h-5 text-white/50" />}
    </div>
  );
}
