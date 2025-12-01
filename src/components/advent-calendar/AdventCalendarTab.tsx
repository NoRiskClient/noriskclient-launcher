"use client";

import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { useLauncherTheme } from "../../hooks/useLauncherTheme";
import { AdventRewardModal } from "./AdventRewardModal";
import { getAdventCalendar, claimAdventCalendarDay } from "../../services/nrc-service";
import type { Reward, AdventCalendarDay, AdventCalendarDayStatus } from "../../types/advent";
import { toast } from "react-hot-toast";
import { getLauncherConfig } from "../../services/launcher-config-service";

interface AdventDoorProps {
  day: number;
  status: AdventCalendarDayStatus;
  reward: Reward | null;
  shopItemName?: string | null;
  onOpen: (day: number) => void;
}

function getRewardShortLabel(reward: Reward | null, shopItemName?: string | null): string {
  if (!reward) return "Opened";
  
  switch (reward.type) {
    case "Coins":
      return `${reward.amount} Coins`;
    case "ShopItem":
      return shopItemName || "Shop Item";
    case "RandomShopItem":
      return `Random ${reward.itemType}`;
    case "Discount":
      return `${reward.percentage}% Off`;
    case "NrcPlus":
      return `${Math.floor(reward.duration / (1000 * 60 * 60 * 24))}d Plus`;
    case "Theme":
      return "Theme";
    default:
      return "Opened";
  }
}

interface AdventDoorWithProps extends AdventDoorProps {
  debugFlag: boolean;
  canOpenDay: (day: number) => boolean;
}

function AdventDoor({ day, status, reward, shopItemName, onOpen, debugFlag, canOpenDay }: AdventDoorWithProps) {
  const [isHovered, setIsHovered] = useState(false);
  const accentColor = useThemeStore((state) => state.accentColor);

  const handleClick = () => {
    if (debugFlag || canOpenDay(day) || status === "AVAILABLE" || status === "CLAIMED") {
      onOpen(day);
    }
  };

  const isLocked = debugFlag ? false : (!canOpenDay(day) && status === "LOCKED");
  const isOpen = status === "CLAIMED";
  const rewardLabel = getRewardShortLabel(reward, shopItemName);

  return (
    <div
      className={`relative flex flex-col items-center justify-center p-4 rounded-lg bg-black/20 border transition-all duration-200 cursor-pointer aspect-square ${
        isLocked
          ? "border-white/5 cursor-not-allowed opacity-50"
          : "border-white/10 hover:border-white/20"
      }`}
      style={{
        backgroundColor: isHovered && !isLocked ? `${accentColor.value}20` : isHovered && isLocked ? `${accentColor.value}10` : undefined,
        borderColor: isHovered && !isLocked ? `${accentColor.value}60` : isHovered && isLocked ? `${accentColor.value}30` : undefined,
        transform: isHovered && !isLocked ? "scale(1.05)" : "scale(1)",
        boxShadow: isHovered && !isLocked 
          ? `0 0 20px ${accentColor.value}40, 0 4px 12px rgba(0,0,0,0.3)` 
          : "0 2px 8px rgba(0,0,0,0.2)",
        zIndex: isHovered ? 10 : 1,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      {/* Day Number */}
      <div className="absolute top-2 left-2">
        <span
          className="font-minecraft-ten text-lg text-white/70"
          style={{ textShadow: "0 2px 4px rgba(0,0,0,0.7)" }}
        >
          {day}
        </span>
      </div>

      {/* Door Content */}
      <div className="flex flex-col items-center justify-center gap-2">
        {isOpen ? (
          <>
            <Icon
              icon="solar:gift-bold"
              className="w-12 h-12 transition-transform duration-200"
              style={{ 
                color: accentColor.value,
                transform: isHovered ? "scale(1.1) rotate(5deg)" : "scale(1)",
                filter: isHovered ? `drop-shadow(0 0 8px ${accentColor.value}80)` : undefined,
              }}
            />
            <span
              className="font-minecraft-ten text-xs text-white/80 uppercase transition-colors duration-200 text-center px-1"
              style={{ 
                textShadow: "0 1px 2px rgba(0,0,0,0.5)",
                color: isHovered ? accentColor.value : undefined,
              }}
              title={rewardLabel}
            >
              {rewardLabel}
            </span>
          </>
        ) : isLocked ? (
          <Icon
            icon="solar:lock-bold"
            className="w-12 h-12 text-white/30 transition-transform duration-200"
            style={{
              transform: isHovered ? "scale(1.1)" : "scale(1)",
            }}
          />
        ) : (
          <>
            <Icon
              icon="solar:calendar-bold"
              className="w-12 h-12 text-white/50 transition-all duration-200"
              style={{
                transform: isHovered ? "scale(1.15) rotate(-5deg)" : "scale(1)",
                color: isHovered ? accentColor.value : undefined,
                filter: isHovered ? `drop-shadow(0 0 6px ${accentColor.value}60)` : undefined,
              }}
            />
            <span
              className="font-minecraft-ten text-xs text-white/60 uppercase transition-colors duration-200"
              style={{ 
                textShadow: "0 1px 2px rgba(0,0,0,0.5)",
                color: isHovered ? accentColor.value : undefined,
              }}
            >
              Open
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function AdventCalendarTab() {
  const [calendarData, setCalendarData] = useState<AdventCalendarDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claimingDay, setClaimingDay] = useState<number | null>(null);
  const [debugFlag, setDebugFlag] = useState(false);
  const { showModal, hideModal } = useGlobalModal();
  const { markAdventDoorOpened } = useLauncherTheme();

  // Get current day in December (1-24)
  const getCurrentAdventDay = (): number => {
    const today = new Date();
    const day = today.getDate();
    // Clamp to 1-24 for advent calendar
    return Math.max(1, Math.min(24, day));
  };

  // Check if a day can be opened (today and last 2 days)
  const canOpenDay = (day: number): boolean => {
    const currentDay = getCurrentAdventDay();
    // Can open: today, yesterday (currentDay - 1), and day before yesterday (currentDay - 2)
    return day <= currentDay && day >= Math.max(1, currentDay - 2);
  };

  // Load launcher config to check experimental mode
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await getLauncherConfig();
        setDebugFlag(config.is_experimental);
      } catch (err) {
        console.error("Failed to load launcher config:", err);
        // Default to false if config can't be loaded
        setDebugFlag(false);
      }
    };

    loadConfig();
  }, []);

  // Load advent calendar data on mount
  useEffect(() => {
    const loadCalendarData = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getAdventCalendar();
        console.log("Advent calendar data:", data);
        setCalendarData(data);
      } catch (err) {
        console.error("Failed to load advent calendar:", err);
        setError(err.message);
        toast.error("Failed to load advent calendar");
      } finally {
        setLoading(false);
      }
    };

    loadCalendarData();
  }, []);

  // Get day data from calendar
  const getDayData = (day: number): AdventCalendarDay | undefined => {
    return calendarData.find((d) => d.day === day);
  };

  const handleDoorOpen = async (day: number) => {
    const dayData = getDayData(day);
    
    // Don't allow opening if currently claiming
    if (claimingDay !== null) {
      return;
    }

    // If already claimed, just show the reward
    if (dayData && dayData.status === "CLAIMED" && dayData.reward) {
      const modalId = `advent-reward-${day}`;
      showModal(
        modalId,
        <AdventRewardModal
          isOpen={true}
          onClose={() => {
            hideModal(modalId);
          }}
          day={day}
          reward={dayData.reward}
          shopItemName={dayData.shopItemName}
          shopItemModelUrl={dayData.shopItemModelUrl}
          isLoading={false}
        />,
      );
      return;
    }

    // If not available and debug flag is off, check if day can be opened (today and last 2 days)
    if (!debugFlag && (!dayData || dayData.status !== "AVAILABLE") && !canOpenDay(day)) {
      return;
    }

    setClaimingDay(day);

    // Show modal with loading state
    const modalId = `advent-reward-${day}`;
    showModal(
      modalId,
      <AdventRewardModal
        isOpen={true}
        onClose={() => {
          hideModal(modalId);
          setClaimingDay(null);
        }}
        day={day}
        reward={null}
        isLoading={true}
      />,
    );

    try {
      const claimedDay = await claimAdventCalendarDay(day);
      
      // Mark door as opened in launcher theme store
      markAdventDoorOpened(day);
      
      // Refresh calendar data after claiming
      const updatedData = await getAdventCalendar();
      setCalendarData(updatedData);

      // Update modal with reward (extract reward from AdventCalendarDay)
      showModal(
        modalId,
        <AdventRewardModal
          isOpen={true}
          onClose={() => {
            hideModal(modalId);
            setClaimingDay(null);
          }}
          day={day}
          reward={claimedDay.reward}
          shopItemName={claimedDay.shopItemName}
          shopItemModelUrl={claimedDay.shopItemModelUrl}
          isLoading={false}
        />,
      );
      
      toast.success(`Day ${day} reward claimed!`);
    } catch (error) {
      console.error("Failed to claim reward:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to claim reward";
      toast.error(errorMessage);
      
      // Show error in modal
      showModal(
        modalId,
        <AdventRewardModal
          isOpen={true}
          onClose={() => {
            hideModal(modalId);
            setClaimingDay(null);
          }}
          day={day}
          reward={null}
          isLoading={false}
        />,
      );
    } finally {
      setClaimingDay(null);
    }
  };

  // Calculate opened doors count
  const openedDoorsCount = calendarData.filter((day) => day.status === "CLAIMED").length;
  
  // Get current date using locale string
  const today = new Date();
  const formattedDate = today.toLocaleDateString();

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 relative">
      <div className="flex-1 overflow-y-auto no-scrollbar overflow-x-hidden">
        {/* Header */}
        <div className="mb-6 pb-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            {/* Left: Title */}
            <div>
              <h1 className="font-minecraft text-4xl mb-1" style={{ textShadow: "0 2px 4px rgba(0,0,0,0.7)" }}>
                Advent Calendar
              </h1>
              <p className="text-white/70 font-minecraft-ten text-sm">
                Open a door every day in December
              </p>
            </div>
            
            {/* Right: Stats */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Icon
                  icon="solar:calendar-bold"
                  className="w-4 h-4 text-white/60"
                />
                <span className="font-minecraft-ten text-sm text-white/70">
                  {formattedDate}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Icon
                  icon="solar:gift-bold"
                  className="w-4 h-4 text-white/60"
                />
                <span className="font-minecraft-ten text-sm text-white/70">
                  {openedDoorsCount} / 24 opened
                </span>
              </div>
            </div>
          </div>
        </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin">
            <Icon
              icon="solar:refresh-bold"
              className="w-8 h-8 text-white/50"
            />
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <Icon
            icon="solar:info-circle-bold"
            className="w-12 h-12 text-red-500"
          />
          <p className="font-minecraft-ten text-white/70">{error}</p>
        </div>
      )}

        {/* Grid */}
        {!loading && !error && (
          <div className="grid grid-cols-6 gap-4 max-w-6xl mx-auto w-full px-4 py-2">
            {Array.from({ length: 24 }, (_, i) => i + 1).map((day) => {
              const dayData = getDayData(day);
              const status = dayData?.status || "LOCKED";
              const reward = dayData?.reward || null;
              const shopItemName = dayData?.shopItemName || null;
              
              return (
                <AdventDoor
                  key={day}
                  day={day}
                  status={status}
                  reward={reward}
                  shopItemName={shopItemName}
                  onOpen={() => handleDoorOpen(day)}
                  debugFlag={debugFlag}
                  canOpenDay={canOpenDay}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

