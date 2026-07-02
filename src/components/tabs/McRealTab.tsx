"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useMcRealStore, type McRealFeedTab } from "../../store/mcreal-store";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { useThemeStore } from "../../store/useThemeStore";
import { useIsMobile } from "../../hooks/useIsMobile";
import { McRealPostCard } from "../mcreal/McRealPostCard";
import type { McRealSort } from "../../types/mcreal";

const TABS: { id: McRealFeedTab; labelKey: string }[] = [
  { id: "friends", labelKey: "mcreal.tabs.friends" },
  { id: "discovery", labelKey: "mcreal.tabs.discovery" },
  { id: "partners", labelKey: "mcreal.tabs.partners" },
];

const SORTS: McRealSort[] = [
  "NEWEST",
  "OLDEST",
  "MOST_LIKES",
  "MOST_DISLIKES",
  "BEST_RATING",
  "STREAK",
];

export function McRealTab() {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const isMobile = useIsMobile();
  const activeAccount = useMinecraftAuthStore((s) => s.activeAccount);
  const {
    activeTab,
    sort,
    posts,
    loading,
    loadingMore,
    hasMore,
    error,
    todayPost,
    setTab,
    setSort,
    loadFeed,
    loadMore,
    refreshTodayPost,
  } = useMcRealStore();
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeAccount) return;
    void loadFeed(true);
    void refreshTodayPost();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccount?.id]);

  // Infinite scroll via bottom sentinel.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  if (!activeAccount) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-white/50">
        <Icon icon="solar:user-cross-bold" className="w-10 h-10" />
        <span className="font-minecraft-ten text-sm">
          {t("mcreal.no_account")}
        </span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header: tabs + sort */}
      <div
        className={`flex items-center gap-2 border-b backdrop-blur-md z-10 ${isMobile ? "px-3 py-2" : "px-6 py-3"}`}
        style={{ borderColor: `${accentColor.value}30` }}
      >
        <h2 className="font-minecraft text-2xl lowercase text-shadow mr-2">
          mcreal
        </h2>
        <div className="flex items-center gap-1 flex-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={`border-none rounded-md cursor-pointer font-minecraft-ten transition-colors ${isMobile ? "px-2.5 py-1.5 text-[11px]" : "px-4 py-2 text-xs"} ${activeTab === tab.id ? "text-white" : "text-white/50 bg-transparent hover:text-white"}`}
              style={
                activeTab === tab.id
                  ? { backgroundColor: `${accentColor.value}50` }
                  : undefined
              }
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as McRealSort)}
          className="bg-black/40 border border-white/20 rounded-md text-white font-minecraft-ten text-[11px] px-1.5 py-1.5 outline-none cursor-pointer"
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`mcreal.sort.${s.toLowerCase()}`)}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            void loadFeed(true);
            void refreshTodayPost();
          }}
          className="bg-transparent border-none cursor-pointer text-white/50 hover:text-white p-1"
          aria-label={t("mcreal.refresh")}
        >
          <Icon icon="solar:refresh-bold" className="w-4.5 h-4.5" />
        </button>
      </div>

      {/* Not-posted banner */}
      {!todayPost && !loading && (
        <div
          className={`flex items-center gap-2 border-b ${isMobile ? "px-3 py-2" : "px-6 py-2.5"}`}
          style={{
            borderColor: `${accentColor.value}30`,
            backgroundColor: `${accentColor.value}15`,
          }}
        >
          <Icon icon="solar:camera-bold" className="w-4 h-4 text-white/70 flex-shrink-0" />
          <span className="font-minecraft-ten text-[11px] text-white/70">
            {t("mcreal.banner.not_posted")}
          </span>
        </div>
      )}

      {/* Feed: single column on mobile, grid on desktop */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div
          className={`mx-auto ${
            isMobile
              ? "flex flex-col gap-4 max-w-full px-3 py-3"
              : "grid grid-cols-2 min-[1500px]:grid-cols-3 gap-5 items-start max-w-[1200px] px-6 py-6"
          }`}
        >
          {loading && (
            <div className="col-span-full flex justify-center py-10">
              <Icon
                icon="solar:refresh-bold"
                className="w-8 h-8 text-white/40 animate-spin"
              />
            </div>
          )}

          {error && !loading && (
            <div className="col-span-full text-center py-8">
              <span className="font-minecraft-ten text-xs text-red-400 break-words">
                {error}
              </span>
            </div>
          )}

          {!loading && !error && posts.length === 0 && (
            <div className="col-span-full flex flex-col items-center gap-3 py-14 text-white/40">
              <Icon icon="solar:gallery-bold" className="w-10 h-10" />
              <span className="font-minecraft-ten text-xs">
                {t("mcreal.feed.empty")}
              </span>
            </div>
          )}

          {posts.map((entry) => (
            <McRealPostCard key={entry.post._id} entry={entry} />
          ))}

          <div ref={sentinelRef} className="col-span-full" />

          {loadingMore && (
            <div className="col-span-full flex justify-center py-4">
              <Icon
                icon="solar:refresh-bold"
                className="w-5 h-5 text-white/40 animate-spin"
              />
            </div>
          )}

          {!hasMore && posts.length > 0 && (
            <div className="col-span-full text-center py-4 font-minecraft-ten text-[11px] text-white/30">
              {t("mcreal.feed.end")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
