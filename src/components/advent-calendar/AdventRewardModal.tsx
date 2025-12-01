"use client";

import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Icon } from "@iconify/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { useThemeStore } from "../../store/useThemeStore";
import type { Reward } from "../../types/advent";
import { CosmeticPreview } from "./CosmeticPreview";
import { getOrDownloadAssetModel } from "../../services/assets-service";
import { LAUNCHER_THEMES } from "../../store/launcher-theme-store";

interface AdventRewardModalProps {
  isOpen: boolean;
  onClose: () => void;
  day: number;
  reward: Reward | null;
  shopItemName?: string | null;
  shopItemModelUrl?: string | null;
  isLoading?: boolean;
}

function RewardDisplay({ reward, shopItemName, shopItemModelUrl }: { reward: Reward; shopItemName?: string | null; shopItemModelUrl?: string | null }) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [themeImageError, setThemeImageError] = useState(false);

  useEffect(() => {
    if (reward?.type === "ShopItem") {
      setIsLoadingModel(true);
      // Use shopItemModelUrl if available, otherwise fallback to hardcoded URL
      const cdnUrl = shopItemModelUrl || "https://cdn.norisk.gg/misc/fivehead.gltf";
      getOrDownloadAssetModel(cdnUrl)
        .then((url) => {
          setModelUrl(url);
          setIsLoadingModel(false);
        })
        .catch((error) => {
          console.error("Failed to load asset model:", error);
          setIsLoadingModel(false);
        });
    }
  }, [reward, shopItemModelUrl]);

  // Reset theme image error when reward changes
  useEffect(() => {
    if (reward?.type === "Theme") {
      setThemeImageError(false);
    }
  }, [reward?.type === "Theme" ? reward.themeId : null]);

  const renderReward = () => {
    switch (reward.type) {
      case "Coins":
        return (
          <div className="flex flex-col items-center gap-4">
            <div
              className="w-24 h-24 rounded-lg flex items-center justify-center border-2 overflow-hidden"
              style={{
                backgroundColor: `${accentColor.value}20`,
                borderColor: accentColor.value,
              }}
            >
              <img
                src="/coins.png"
                alt="Coins"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="text-center">
              <p className="font-minecraft-ten text-2xl text-white mb-1">
                {reward.amount} Coins
              </p>
              <p className="font-minecraft-ten text-white/60 text-sm">Added to your account</p>
            </div>
          </div>
        );

      case "ShopItem":
        return (
          <div className="flex flex-col items-center gap-4 w-full">
            <div
              className="w-full h-96 overflow-hidden"
            >
              {modelUrl && !isLoadingModel ? (
                <CosmeticPreview modelPath={modelUrl} />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-white/50 text-sm font-minecraft-ten">
                    {isLoadingModel ? "Loading model..." : "Preparing model..."}
                  </div>
                </div>
              )}
            </div>
            <div className="text-center">
              <p className="font-minecraft-ten text-xl text-white mb-1">
                {shopItemName || "Shop Item"}
              </p>
              <p className="font-minecraft-ten text-white/60 text-sm">
                {reward.duration
                  ? `Duration: ${Math.floor(reward.duration / (1000 * 60 * 60 * 24))} days`
                  : "Permanent"}
              </p>
            </div>
          </div>
        );

      case "RandomShopItem":
        return (
          <div className="flex flex-col items-center gap-4">
            <div
              className="w-24 h-24 rounded-lg flex items-center justify-center border-2"
              style={{
                backgroundColor: `${accentColor.value}20`,
                borderColor: accentColor.value,
              }}
            >
              <Icon
                icon="solar:gift-bold"
                className="w-16 h-16"
                style={{ color: accentColor.value }}
              />
            </div>
            <div className="text-center">
              <p className="font-minecraft-ten text-xl text-white mb-1">
                Random {reward.itemType}
              </p>
              <p className="font-minecraft-ten text-white/60 text-sm">
                {reward.duration
                  ? `Duration: ${Math.floor(reward.duration / (1000 * 60 * 60 * 24))} days`
                  : "Permanent"}
              </p>
            </div>
          </div>
        );

      case "Discount":
        return (
          <div className="flex flex-col items-center gap-4">
            <div
              className="w-24 h-24 rounded-lg flex items-center justify-center border-2"
              style={{
                backgroundColor: `${accentColor.value}20`,
                borderColor: accentColor.value,
              }}
            >
              <Icon
                icon="solar:tag-price-bold"
                className="w-16 h-16"
                style={{ color: accentColor.value }}
              />
            </div>
            <div className="text-center">
              <p className="font-minecraft-ten text-2xl text-white mb-1">
                {reward.percentage}% Discount
              </p>
              <p className="font-minecraft-ten text-white/60 text-sm">
                Valid until {new Date(reward.endTimestamp).toLocaleDateString()}
              </p>
              <p className="font-minecraft-ten text-white/60 text-sm mt-1">
                Redeemable once for your next in-game purchase
              </p>
            </div>
          </div>
        );

      case "NrcPlus":
        return (
          <div className="flex flex-col items-center gap-4">
            <div
              className="w-24 h-24 rounded-lg flex items-center justify-center border-2"
              style={{
                backgroundColor: `${accentColor.value}20`,
                borderColor: accentColor.value,
              }}
            >
              <Icon
                icon="solar:star-bold"
                className="w-16 h-16"
                style={{ color: accentColor.value }}
              />
            </div>
            <div className="text-center">
              <p className="font-minecraft-ten text-xl text-white mb-1">
                NoRisk Plus
              </p>
              <p className="font-minecraft-ten text-white/60 text-sm">
                {Math.floor(reward.duration / (1000 * 60 * 60 * 24))} days
              </p>
            </div>
          </div>
        );

      case "Theme":
        const theme = LAUNCHER_THEMES[reward.themeId];
        const themeImage = theme?.backgroundImage;
        console.log("[AdventRewardModal] Theme reward:", { themeId: reward.themeId, theme, themeImage, themeImageError });
        
        return (
          <div className="flex flex-col items-center gap-4">
            <div
              className="w-full h-64 rounded-lg flex items-center justify-center border-2 overflow-hidden relative"
              style={{
                backgroundColor: `${accentColor.value}20`,
                borderColor: accentColor.value,
                minHeight: '256px',
              }}
            >
              {themeImage && !themeImageError ? (
                <img
                  src={themeImage}
                  alt={theme?.name || reward.themeId}
                  className="w-full h-full object-cover"
                  style={{ display: 'block' }}
                  onError={(e) => {
                    console.error("[AdventRewardModal] Failed to load theme image:", themeImage, e);
                    setThemeImageError(true);
                  }}
                  onLoad={() => {
                    console.log("[AdventRewardModal] Theme image loaded successfully:", themeImage);
                  }}
                />
              ) : (
                <Icon
                  icon="solar:palette-bold"
                  className="w-16 h-16"
                  style={{ color: accentColor.value }}
                />
              )}
            </div>
            <div className="text-center">
              <p className="font-minecraft-ten text-xl text-white mb-1">
                {theme?.name || "Theme Unlocked"}
              </p>
              {!theme && (
                <p className="font-minecraft-ten text-white/60 text-sm mb-1">Theme ID: {reward.themeId}</p>
              )}
              <p className="font-minecraft-ten text-white/60 text-sm">
                You can apply this theme in Settings/Background
              </p>
            </div>
          </div>
        );

      default:
        return (
          <div className="flex flex-col items-center gap-4">
            <Icon
              icon="solar:gift-bold"
              className="w-16 h-16"
              style={{ color: accentColor.value }}
            />
            <p className="font-minecraft-ten text-xl text-white">Unknown Reward</p>
          </div>
        );
    }
  };

  return <div className="py-6">{renderReward()}</div>;
}

function DoorAnimation({ 
  isOpen, 
  onAnimationComplete 
}: { 
  isOpen: boolean; 
  onAnimationComplete: () => void;
}) {
  useEffect(() => {
    if (isOpen) {
      // Trigger callback after door animation completes (initial delay + animation duration + buffer)
      const timer = setTimeout(() => {
        onAnimationComplete();
      }, 2000); // 1s initial delay + 0.8s animation + 0.2s buffer
      return () => clearTimeout(timer);
    }
  }, [isOpen, onAnimationComplete]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="absolute inset-0 flex items-center justify-center z-20"
          style={{ 
            perspective: "1200px",
            perspectiveOrigin: "center center",
          }}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1, delay: 0 }}
        >
          <motion.div
            className="flex items-center justify-center"
            initial={{ rotateY: 0, scale: 0.4, x: "25%" }}
            animate={{ rotateY: -90, scale: 0.4, x: "25%" }}
            transition={{
              duration: 0.8,
              delay: 1, // Initial delay before door opens
              ease: [0.25, 0.46, 0.45, 0.94], // Custom easing for smooth door swing
            }}
            style={{
              transformStyle: "preserve-3d",
              transformOrigin: "left center",
            }}
          >
            <img
              src="/mc_door.png"
              alt="Door"
              className="max-w-[60%] max-h-[60%] object-contain"
              style={{
                imageRendering: "pixelated", // Keep pixel art crisp
              }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CoinRain({ isActive }: { isActive: boolean }) {
  const coins = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => ({
      id: i,
      x: Math.random() * 80 + 10, // Keep coins away from edges (10% to 90%)
      delay: Math.random() * 2,
      duration: Math.random() * 2 + 3,
      rotation: Math.random() * 180,
      size: Math.random() * 20 + 16,
    }));
  }, []);

  if (!isActive) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-0" style={{ overflow: "visible" }}>
      {coins.map((coin) => (
        <motion.div
          key={coin.id}
          className="absolute"
          initial={{
            top: "-5%",
            left: `${coin.x}%`,
            opacity: 0,
            rotate: coin.rotation,
            scale: 0.5,
          }}
          animate={{
            top: "105%",
            opacity: [0, 1, 1, 0],
            rotate: coin.rotation + 180,
            scale: [0.5, 1, 1, 0.8],
          }}
          transition={{
            duration: coin.duration,
            delay: coin.delay,
            repeat: Infinity,
            ease: "linear",
          }}
          style={{
            width: coin.size,
            height: coin.size,
            filter: "drop-shadow(0 0 4px rgba(255, 215, 0, 0.8))",
            marginLeft: `-${coin.size / 2}px`, // Center coins horizontally
          }}
        >
          <img
            src="/coin.png"
            alt="Coin"
            className="w-full h-full object-contain"
          />
        </motion.div>
      ))}
    </div>
  );
}

export function AdventRewardModal({
  isOpen,
  onClose,
  day,
  reward,
  shopItemName,
  shopItemModelUrl,
  isLoading = false,
}: AdventRewardModalProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const showCoinRain = isOpen && reward?.type === "Coins" && !isLoading;
  const [doorAnimationComplete, setDoorAnimationComplete] = useState(false);

  const handleDoorAnimationComplete = () => {
    setDoorAnimationComplete(true);
  };

  // Reset door animation when modal closes
  useEffect(() => {
    if (!isOpen) {
      setDoorAnimationComplete(false);
    }
  }, [isOpen]);

  // Reset door animation when loading starts
  useEffect(() => {
    if (isLoading) {
      setDoorAnimationComplete(false);
    }
  }, [isLoading]);

  // Show door animation while loading or until door opens
  const showDoorAnimation = isLoading || (isOpen && !doorAnimationComplete && !!reward);

  return (
    <Modal
      title={`Day ${day} Reward`}
      titleIcon={
        <Icon
          icon="solar:gift-bold"
          className="w-6 h-6"
          style={{ color: accentColor.value }}
        />
      }
      onClose={onClose}
      width="lg"
      contentClassName="no-scrollbar"
    >
      <div className="p-6 min-h-[300px] flex flex-col justify-center relative no-scrollbar" style={{ overflow: "visible" }}>
        {/* Door Animation - shows while loading or until door opens */}
        <div className="absolute inset-0 flex items-center justify-center" style={{ top: 0, bottom: 0 }}>
          <DoorAnimation 
            isOpen={showDoorAnimation} 
            onAnimationComplete={handleDoorAnimationComplete}
          />
        </div>
        
        {/* Content - only show after door animation completes and not loading */}
        <AnimatePresence>
          {doorAnimationComplete && !isLoading && (
            <motion.div
              className="relative z-10 w-full"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <CoinRain isActive={showCoinRain} />
              {reward ? (
                <RewardDisplay reward={reward} shopItemName={shopItemName} shopItemModelUrl={shopItemModelUrl} />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <Icon
                    icon="solar:info-circle-bold"
                    className="w-12 h-12 text-white/50"
                  />
                  <p className="font-minecraft-ten text-white/70">No reward available</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}

