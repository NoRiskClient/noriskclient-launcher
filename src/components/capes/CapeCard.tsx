"use client";

import type React from "react";
import { useEffect, useState } from "react";
import type { CosmeticCape } from "../../types/noriskCapes";
import { useThemeStore } from "../../store/useThemeStore";
import { IconButton } from "../ui/buttons/IconButton";
import { getPlayerProfileByUuidOrName } from "../../services/cape-service";
// import type { MinecraftProfile } from '../../types/minecraft'; // Not needed if not fetching profile for display
import { Icon } from "@iconify/react";
import { CapeImage } from "./CapeImage"; // Assuming we want to show a 2D preview
import { Card } from "../ui/Card";
import { cn } from "../../lib/utils";
import { useCapeFavoritesStore } from "../../store/useCapeFavoritesStore";

interface CapeCardProps {
  cape: CosmeticCape;
  onEquip: (capeHash: string) => void;
  isSelected?: boolean;
  isLoading?: boolean;
  index: number;
  onDelete?: (e: React.MouseEvent) => void;
}

const CARD_MIN_WIDTH = 210;
const IMAGE_TARGET_HEIGHT = 160;
const IMAGE_TARGET_WIDTH = 100;

export function CapeCard({
  cape,
  onEquip,
  isSelected,
  isLoading,
  index,
  onDelete,
}: CapeCardProps) {
  const { _id: capeHash, elytra, uses, firstSeen: creatorUuid } = cape;
  const imageUrl = `https://cdn.norisk.gg/capes/prod/${capeHash}.png`;
  const [creatorName, setCreatorName] = useState<string | null>(null);

  const accentColor = useThemeStore((state) => state.accentColor);
  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled,
  );
  const isFavorite = useCapeFavoritesStore((s) => s.isFavorite(capeHash));
  const toggleFavoriteOptimistic = useCapeFavoritesStore((s) => s.toggleFavoriteOptimistic);

  useEffect(() => {
    if (creatorUuid && !creatorName) {
      let isMounted = true;
      getPlayerProfileByUuidOrName(creatorUuid)
        .then((profile) => {
          if (isMounted && profile && profile.name) {
            setCreatorName(profile.name);
          }
        })
        .catch((err) => {
          if (isMounted) {
            console.warn(
              `Failed to fetch profile for UUID ${creatorUuid}:`,
              err,
            );
          }
        });
      return () => {
        isMounted = false;
      };
    }
  }, [creatorUuid, creatorName]);

  const animationStyle = isBackgroundAnimationEnabled
    ? { animationDelay: `${index * 0.075}s` }
    : {};
  const animationClasses = isBackgroundAnimationEnabled
    ? "animate-in fade-in duration-500 fill-mode-both"
    : "";

  return (
    <div style={animationStyle} className={animationClasses}>
      <Card
        className={cn(
          "relative p-4 pt-1.5 pb-2 h-[380px] flex flex-col text-center group",
          "transition-all duration-300 ease-out hover:scale-105 hover:z-10",
          isLoading ? "opacity-60 pointer-events-none" : "",
          `min-w-[${CARD_MIN_WIDTH}px]`,
        )}
        variant={isSelected ? "flat" : "flat"}
        onClick={() => !isLoading && onEquip(capeHash)}
      >
        <div className={cn(
          "absolute top-1.5 right-1.5 z-10 transition-all duration-300 ease-out group-hover:scale-110",
          isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}>
          <IconButton
            onClick={(event) => {
              event.stopPropagation();
              toggleFavoriteOptimistic(capeHash);
            }}
            title={isFavorite ? "Unfavorite" : "Favorite"}
            disabled={isLoading}
            size="xs"
            variant="ghost"
            icon={
              <Icon
                icon={isFavorite ? "ph:heart-fill" : "ph:heart"}
                className="w-5 h-5"
                style={{ color: "#ef4444" }}
              />
            }
          />
        </div>
        <p
          className="font-minecraft text-white lowercase truncate text-3xl transition-transform duration-300 ease-out group-hover:scale-110"
          title={creatorName ? `By ${creatorName}` : capeHash}
        >
          {creatorName ? creatorName : "Unknown"}
        </p>

        <div className="h-64 flex relative pt-2 pb-2 flex-grow items-center justify-center transition-transform duration-300 ease-out group-hover:scale-105">
          <div
            className="w-full flex items-center justify-center relative bg-black/10 rounded overflow-hidden"
            style={{ height: `${IMAGE_TARGET_HEIGHT}px` }}
          >
            <CapeImage
              imageUrl={imageUrl}
              part="front"
              width={IMAGE_TARGET_WIDTH}
              className="max-h-full max-w-full object-contain"
            />

            {elytra && (
              <div
                className="absolute top-1 left-1 bg-accent text-accent-foreground px-1.5 py-0.5 text-xs font-bold rounded-sm pixelated-text shadow-md uppercase z-10"
                title="This cape includes an Elytra texture."
                style={{ backgroundColor: accentColor.value, color: "#ffffff" }}
              >
                Elytra
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mt-auto">
          <p className="text-white/60 font-minecraft lowercase text-2xl transition-transform duration-300 ease-out group-hover:scale-110">
            Uses: {uses.toLocaleString()}
          </p>
        </div>

        {isLoading && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center rounded-lg z-20 transition-opacity duration-300 ease-in-out">
            <div className="w-20 h-20 border-4 border-t-transparent border-white rounded-full animate-spin mb-4 transition-all duration-300"></div>
            <span className="font-minecraft text-2xl text-white lowercase animate-pulse transition-all duration-300">
              Applying...
            </span>
          </div>
        )}

        {onDelete && (
          <div className="absolute bottom-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 transition-all duration-300 ease-out group-hover:scale-110">
            <IconButton
              onClick={(event) => {
                event.stopPropagation();
                onDelete(event);
              }}
              title="Delete cape"
              disabled={isLoading}
              size="xs"
              variant="destructive"
              icon={
                <Icon icon="solar:trash-bin-trash-bold" className="w-4 h-4" />
              }
            />
          </div>
        )}
      </Card>
    </div>
  );
}
