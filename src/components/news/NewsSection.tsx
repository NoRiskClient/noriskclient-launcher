import { useCallback, useEffect, useState } from "react";
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

export function NewsSection({ className }: { className?: string }) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const locale = newsLocale(useThemeStore((state) => state.language));

  const { items, page, totalPages, error, setFirstPage, appendPage, setError } = useNewsStore();
  const [loadingMore, setLoadingMore] = useState(false);
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
          const displayTitle = item.title[locale] || item.title.en || t('news.item');
          const postUrl = item.url?.[locale] || item.url?.en;

          return (
            <NewsCard
              key={item.id}
              title={displayTitle}
              imageUrl={item.thumbnailUrl}
              accent={accentColor.value}
              onOpen={
                postUrl
                  ? () => openExternalUrl(postUrl).catch((err) => console.error("Failed to open URL:", err))
                  : undefined
              }
            />
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
    <div className={cn("h-full flex flex-col", className)}>
      <div className="flex-1 overflow-y-auto overflow-x-hidden no-scrollbar relative">
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
