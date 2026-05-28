"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "../ui/Tooltip";
import {
  getUniquePlayers24h,
  type UniquePlayersResponse,
} from "../../services/nrc-service";
import { useQualitySettingsStore } from "../../store/quality-settings-store";

interface HeaderInfoCarouselProps {
  version: string | null;
}

const SLIDE_INTERVAL_MS = 8000;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const TEXT_CLASSES =
  "text-white/70 font-minecraft-ten text-[8px] font-normal leading-none";

export function HeaderInfoCarousel({ version }: HeaderInfoCarouselProps) {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState<UniquePlayersResponse | null>(null);
  const qualityLevel = useQualitySettingsStore((state) => state.qualityLevel);
  const [showPlayers, setShowPlayers] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isHoveringRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const fetchStats = async () => {
      try {
        const result = await getUniquePlayers24h();
        if (!cancelled) setStats(result);
      } catch (err) {
        console.warn("[HeaderInfoCarousel] fetch failed:", err);
      }
    };

    fetchStats();
    const refreshTimer = setInterval(fetchStats, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
    };
  }, []);

  const startAutoSwitch = () => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      if (!isHoveringRef.current && qualityLevel !== "potato") {
        setShowPlayers((prev) => !prev);
      }
    }, SLIDE_INTERVAL_MS);
  };

  const stopAutoSwitch = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  useEffect(() => {
    setShowPlayers(true);
    if (stats == null) {
      stopAutoSwitch();
      return;
    }
    startAutoSwitch();
    return stopAutoSwitch;
  }, [stats, qualityLevel]);

  const handleMouseEnter = () => {
    isHoveringRef.current = true;
  };
  const handleMouseLeave = () => {
    isHoveringRef.current = false;
  };

  const versionText = `v${version || "?.?.?"}`;
  const playersAvailable = stats != null;
  const formattedCount = playersAvailable
    ? new Intl.NumberFormat(i18n.language || undefined).format(stats!.count)
    : null;
  const playerSlideActive = showPlayers && playersAvailable;

  const content = playerSlideActive ? (
    <Tooltip content={t("header.stats.players_24h_tooltip")}>
      <span className={`${TEXT_CLASSES} inline-flex items-center whitespace-nowrap`}>
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />
        {formattedCount}
      </span>
    </Tooltip>
  ) : (
    <span className={`${TEXT_CLASSES} inline-flex items-center whitespace-nowrap`}>
      {versionText}
    </span>
  );

  return (
    <div
      className="inline-flex -mt-2.5 h-3 min-w-[3.5rem] items-center overflow-hidden"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {content}
    </div>
  );
}
