"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { fetchNewsAndChangelogs } from "../../services/nrc-service";
import { openExternalUrl } from "../../services/tauri-service";
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
  const uiStylePreset = useThemeStore((state) => state.uiStylePreset);
  const isFullRiskStyle = uiStylePreset === "fullrisk";
  const newsSectionWidth = useThemeStore((state) => state.newsSectionWidth);
  const setNewsSectionWidth = useThemeStore(
    (state) => state.setNewsSectionWidth,
  );
  // persisted collapsed state in theme store
  const isCollapsed = useThemeStore((state) => state.newsSectionCollapsed);
  const setIsCollapsed = useThemeStore(
    (state) => state.setNewsSectionCollapsed,
  );
  const [isCollapsedHovered, setIsCollapsedHovered] = useState(false);
  const [isThemeTransitioning, setIsThemeTransitioning] = useState(false);
  const collapsedSize = isFullRiskStyle ? 58 : 46;
  const effectiveCollapsed = isCollapsed;

  const newsSectionHeight = useThemeStore((state) => state.newsSectionHeight);
  const setNewsSectionHeight = useThemeStore(
    (state) => state.setNewsSectionHeight,
  );
  const [isVResizing, setIsVResizing] = useState(false);
  const [startY, setStartY] = useState(0);
  const [startHeight, setStartHeight] = useState(0);

  const { posts, error, setPosts, setError, isCacheValid } = useNewsStore();

  const fadeStrength = 90;

  const loadNews = useCallback(async () => {
    setError(null);

    try {
      const fetchedPosts = await fetchNewsAndChangelogs();
      setPosts(fetchedPosts);
    } catch (err) {
      console.error("[NewsSection] Error fetching news:", err);
      if (!isCacheValid() || posts.length === 0) {
        setError(
          err instanceof Error ? err.message : "An unknown error occurred",
        );
      }
    }
  }, [isCacheValid, posts.length, setError, setPosts]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      setIsResizing(true);
      setStartX(e.clientX);
      setStartWidth(newsSectionWidth);
      e.preventDefault();
    },
    [newsSectionWidth],
  );

  const handleVResizeStart = useCallback(
    (e: React.MouseEvent) => {
      setIsVResizing(true);
      setStartY(e.clientY);
      setStartHeight(newsSectionHeight);
      e.preventDefault();
    },
    [newsSectionHeight],
  );

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  const handleResizeMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const deltaX = e.clientX - startX;
      const newWidth = Math.max(120, Math.min(500, startWidth - deltaX));
      setNewsSectionWidth(newWidth);
    },
    [isResizing, setNewsSectionWidth, startWidth, startX],
  );

  useEffect(() => {
    loadNews();
  }, [loadNews]);

  useEffect(() => {
    const interval = setInterval(
      () => {
        loadNews();
      },
      5 * 60 * 1000,
    );

    return () => clearInterval(interval);
  }, [loadNews]);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener("mousemove", handleResizeMove);
      document.addEventListener("mouseup", handleResizeEnd);
    }

    if (isVResizing) {
      const handleVMove = (e: MouseEvent) => {
        if (!isVResizing) return;
        const deltaY = e.clientY - startY;
        const newHeight = Math.max(
          160,
          Math.min(window.innerHeight - 120, startHeight - deltaY),
        );
        setNewsSectionHeight(newHeight);
      };

      const handleVEnd = () => setIsVResizing(false);

      document.addEventListener("mousemove", handleVMove);
      document.addEventListener("mouseup", handleVEnd);

      return () => {
        document.removeEventListener("mousemove", handleResizeMove);
        document.removeEventListener("mouseup", handleResizeEnd);
        document.removeEventListener("mousemove", handleVMove);
        document.removeEventListener("mouseup", handleVEnd);
      };
    }

    return () => {
      document.removeEventListener("mousemove", handleResizeMove);
      document.removeEventListener("mouseup", handleResizeEnd);
    };
  }, [
    handleResizeEnd,
    handleResizeMove,
    isResizing,
    isVResizing,
    startY,
    startHeight,
    setNewsSectionHeight,
  ]);

  useEffect(() => {
    if (!isFullRiskStyle) {
      setIsThemeTransitioning(false);
      return;
    }

    setIsThemeTransitioning(true);
    const timeout = window.setTimeout(() => {
      setIsThemeTransitioning(false);
    }, 260);

    return () => window.clearTimeout(timeout);
  }, [isFullRiskStyle, uiStylePreset]);

  const renderContent = () => {
    if (error && posts.length === 0) {
      return (
        <div className="text-center p-2">
          <Icon
            icon="pixel:exclamation-triangle-solid"
            className="w-8 h-8 text-red-400 mx-auto mb-2"
          />
          <p className="text-red-400">
            {t("common.error")}: {error}
          </p>
        </div>
      );
    }

    if (posts.length === 0) {
      return (
        <div className="text-center p-2">
          <Icon
            icon="pixel:newspaper-solid"
            className="w-8 h-8 text-white/50 mx-auto mb-2"
          />
          <p className="text-white/70">{t("news.no_news_available")}</p>
        </div>
      );
    }

    return (
      <div className="flex flex-col space-y-1 w-full">
        {posts.map((post) => {
          const rawTitle = post.yoast_head_json?.title || t("news.item");
          const suffixToRemove = " - NoRisk Client Blog";
          const displayTitle = rawTitle.endsWith(suffixToRemove)
            ? rawTitle.substring(0, rawTitle.length - suffixToRemove.length)
            : rawTitle;

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
      className={cn(
        isFullRiskStyle
          ? "flex flex-col z-0 relative overflow-hidden rounded-[26px] border pointer-events-auto"
          : "flex flex-col !p-3 z-0 relative overflow-hidden",
        effectiveCollapsed
          ? isFullRiskStyle
            ? "items-center justify-center"
            : "self-start mt-3 mr-3"
          : "h-full",
        className,
      )}
      style={{
        width: effectiveCollapsed
          ? `${collapsedSize}px`
          : `${newsSectionWidth}px`,
        minWidth: effectiveCollapsed ? `${collapsedSize}px` : undefined,
        maxWidth: effectiveCollapsed
          ? `${collapsedSize}px`
          : isFullRiskStyle
            ? `${newsSectionWidth}px`
            : undefined,
        height: effectiveCollapsed
          ? `${collapsedSize}px`
          : isFullRiskStyle
            ? `${newsSectionHeight}px`
            : undefined,
        minHeight: effectiveCollapsed ? `${collapsedSize}px` : undefined,
        maxHeight: effectiveCollapsed ? `${collapsedSize}px` : undefined,
        borderColor: `${accentColor.value}45`,
        borderLeft: undefined,
        borderRight: undefined,
        background: isFullRiskStyle
          ? isCollapsed
            ? "linear-gradient(160deg, rgba(22,22,28,0.82) 0%, rgba(12,12,18,0.68) 100%)"
            : "linear-gradient(180deg, rgba(23,23,29,0.78) 0%, rgba(10,10,16,0.58) 100%)"
          : undefined,
        backdropFilter: isFullRiskStyle ? "blur(18px)" : undefined,
        WebkitBackdropFilter: isFullRiskStyle ? "blur(18px)" : undefined,
        boxShadow: isFullRiskStyle
          ? `0 24px 60px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 0 1px ${accentColor.value}10`
          : undefined,
        transition: isResizing
          ? "none"
          : isFullRiskStyle
            ? "width 0.26s ease, height 0.26s ease, transform 0.26s ease, background 0.26s ease, border-color 0.26s ease, opacity 0.26s ease"
            : "width 0.2s ease",
        transformOrigin: isFullRiskStyle ? "bottom right" : undefined,
        opacity: effectiveCollapsed
          ? 0.68
          : isFullRiskStyle
            ? isThemeTransitioning
              ? 0.84
              : 1
            : 1,
        transform: isFullRiskStyle
          ? isThemeTransitioning
            ? `${isCollapsed ? "scale(0.98)" : "scale(0.995)"} translateY(2px)`
            : "scale(1) translateY(0)"
          : undefined,
      }}
      onMouseEnter={() => effectiveCollapsed && setIsCollapsedHovered(true)}
      onMouseLeave={() => setIsCollapsedHovered(false)}
    >
      {/* vertical resize handle (fullrisk only) */}
      {!effectiveCollapsed && isFullRiskStyle && (
        <div
          className="absolute left-0 right-0 top-0 h-2 cursor-ns-resize z-20"
          onMouseDown={handleVResizeStart}
        />
      )}
      {!effectiveCollapsed ? (
        <div
          className={cn(
            "absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize z-10",
            isResizing && "bg-white/20",
          )}
          style={{
            backgroundColor: isResizing
              ? `${accentColor.value}40`
              : "transparent",
          }}
          onMouseDown={handleResizeStart}
        />
      ) : null}

      {effectiveCollapsed ? (
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="absolute inset-0 z-20 flex items-center justify-center text-white/75 transition-colors hover:text-white"
          aria-label="Expand news"
        >
          <Icon
            icon={
              isCollapsedHovered
                ? "solar:alt-arrow-left-bold"
                : "pixel:newspaper-solid"
            }
            className={cn(
              "block shrink-0 transition-all duration-150",
              isCollapsedHovered ? "h-5 w-5" : "h-7 w-7",
              isFullRiskStyle && !isCollapsedHovered ? "text-white/85" : "",
            )}
          />
        </button>
      ) : (
        <div className={cn(isFullRiskStyle ? "p-3 pb-2" : "pb-1")}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Icon
                icon="pixel:newspaper-solid"
                className="w-7 h-7 text-white"
              />
              <h2 className="text-2xl font-minecraft lowercase text-white">
                {t("news.title")}
              </h2>
            </div>

            <button
              type="button"
              onClick={() => setIsCollapsed(true)}
              className="text-white/70 hover:text-white transition-all"
              aria-label="Collapse news"
            >
              <Icon
                icon={
                  isFullRiskStyle
                    ? "solar:alt-arrow-right-bold"
                    : "solar:alt-arrow-right-bold"
                }
                className={cn(
                  isFullRiskStyle
                    ? "w-5 h-5 transition-all duration-200"
                    : "w-5 h-5",
                )}
                style={
                  isFullRiskStyle
                    ? {
                        transform: "rotate(45deg)",
                      }
                    : undefined
                }
              />
            </button>
          </div>

          <hr
            className="mt-2 border-t-2"
            style={{ borderColor: `${accentColor.value}40` }}
          />
        </div>
      )}

      {!effectiveCollapsed ? (
        <div
          className={cn(
            isFullRiskStyle
              ? "overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
              : "flex-1 overflow-y-auto no-scrollbar relative",
          )}
          style={
            isFullRiskStyle
              ? {
                  maxHeight: "900px",
                  opacity: 1,
                  transform: "translateY(0) scale(1)",
                }
              : undefined
          }
        >
          <div
            className={cn(
              isFullRiskStyle
                ? "flex-1 overflow-y-auto no-scrollbar relative px-3 pb-0 max-h-[calc(min(68vh,720px)-72px)]"
                : "flex-1 overflow-y-auto no-scrollbar relative",
            )}
          >
            {renderContent()}

            <div
              className={cn(
                "sticky bottom-0 left-0 right-0 pointer-events-none z-10",
                isFullRiskStyle ? "h-24 -mx-3" : "hidden",
              )}
              style={{
                background: `linear-gradient(to top,
                    rgba(23, 23, 29, ${fadeStrength * 0.0085}) 0%,
                    rgba(21, 21, 27, ${fadeStrength * 0.0065}) 26%,
                    rgba(18, 18, 24, ${fadeStrength * 0.0045}) 52%,
                    rgba(15, 15, 20, ${fadeStrength * 0.0025}) 76%,
                    rgba(15, 15, 20, 0) 100%)`,
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
