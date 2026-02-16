"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { fetchNewsAndChangelogs } from "../../services/nrc-service";
import { openExternalUrl } from "../../services/tauri-service";
import type { BlogPost } from "../../types/wordPress";
import { cn } from "../../lib/utils";
import { NewsCard } from "../ui/NewsCard";
import { useThemeStore } from "../../store/useThemeStore";
import { useNewsStore } from "../../store/useNewsStore";

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

  // News Store
  const {
    posts,
    isLoading,
    error,
    setPosts,
    setLoading,
    setError,
    isCacheValid,
  } = useNewsStore();

  // Fade strength configuration (0-100%)
  const fadeStrength = 90; // 90% opacity at bottom

  const loadNews = useCallback(async () => {
    // Setze nur Error zurück, aber zeige keine Loading-Animation
    // Das alte wird weiter angezeigt während wir neu laden
    setError(null);

    try {
      const fetchedPosts = await fetchNewsAndChangelogs();
      setPosts(fetchedPosts);
      console.log("[NewsSection] News data updated");
    } catch (err) {
      console.error("[NewsSection] Error fetching news:", err);
      // Bei Fehler zeige alten Cache falls verfügbar
      if (!isCacheValid() || posts.length === 0) {
        setError(
          err instanceof Error ? err.message : "An unknown error occurred",
        );
      }
    }
  }, [isCacheValid, posts.length, setError, setPosts]);

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
    const newWidth = Math.max(120, Math.min(500, startWidth - deltaX)); // Min 120px, Max 500px
    setNewsSectionWidth(newWidth);
  }, [isResizing, startX, startWidth, setNewsSectionWidth]);

  // Initial load effect - zeige Cache falls verfügbar, dann lade neu
  useEffect(() => {
    // Bei ersten Laden: zeige Cache sofort falls verfügbar
    if (posts.length === 0 && isCacheValid()) {
      console.log("[NewsSection] Showing cached news on initial load");
    }

    // Lade immer neu (auch wenn Cache vorhanden)
    loadNews();
  }, [loadNews]); // loadNews ändert sich nur wenn sich die Dependencies ändern

  // Auto-refresh effect - alle 5 Minuten neu laden
  useEffect(() => {
    const interval = setInterval(() => {
      console.log("[NewsSection] Auto-refreshing news...");
      loadNews();
    }, 5 * 60 * 1000); // 5 Minuten

    return () => clearInterval(interval);
  }, [loadNews]);

  // Global mouse event listeners for resize functionality
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
    // Bei Fehler und keinen gecachten Daten
    if (error && posts.length === 0) {
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

    // Bei keinen Daten überhaupt
    if (posts.length === 0) {
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
        {posts.map((post) => {
          const rawTitle = post.yoast_head_json?.title || t('news.item');
          const suffixToRemove = " - NoRisk Client Blog";
          let displayTitle = rawTitle;
          if (rawTitle.endsWith(suffixToRemove)) {
            displayTitle = rawTitle.substring(
              0,
              rawTitle.length - suffixToRemove.length,
            );
          }

          const imageUrl =
            post.yoast_head_json?.og_image?.[0]?.url || "/placeholder.svg";
          const postUrl = post.yoast_head_json?.og_url || "#";

          return (
            <div key={post.id} className="news-item w-full flex flex-col">
              <p
                className="font-minecraft text-2xl text-white/70 truncate"
                title={displayTitle}
              >
                {displayTitle.toLowerCase()}
              </p>
              <div className="relative w-full pt-[56.25%]">
                <NewsCard
                  id={`news-item-card-${post.id}`}
                  className="absolute top-0 left-0 w-full h-full news-item-card"
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
      {/* Resize handle */}
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
            <h2 className="text-2xl font-minecraft lowercase text-white">{t('news.title')}</h2>
          </div>
        </div>
        <hr
          className="mt-2 border-t-2"
          style={{ borderColor: `${accentColor.value}40` }}
        />
      </div>
      <div className="flex-1 overflow-y-auto no-scrollbar relative">
        {renderContent()}

        {/* Fade overlay at bottom - sticky positioned */}
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