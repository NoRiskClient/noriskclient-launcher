"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CosmeticCape } from "../../types/noriskCapes";
import { EmptyState } from "../ui/EmptyState";
import { Icon } from "@iconify/react";
import { CapeImage } from "./CapeImage";
import { getPlayerProfileByUuidOrName, getCapesByHashes } from "../../services/cape-service";
import { VirtuosoGrid } from "react-virtuoso";
import { useThemeStore } from "../../store/useThemeStore";
import { cn } from "../../lib/utils";
import { Button } from "../ui/buttons/Button";
import { Card } from "../ui/Card";
import { Modal } from "../ui/Modal";
import { SkinView3DWrapper } from "../common/SkinView3DWrapper";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import gsap from "gsap";
import { IconButton } from "../ui/buttons/IconButton";
import { useCapeFavoritesStore } from "../../store/useCapeFavoritesStore";


const ListComponent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ style, children, ...props }, ref) => {
  return (
    <div
      ref={ref}
      {...props}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
        gap: "16px",
        padding: "16px",
        ...style, 
      }}
    >
      {children}
    </div>
  );
});
ListComponent.displayName = "VirtuosoGridList";

interface CapeItemDisplayProps {
  cape: CosmeticCape;
  imageUrl: string;
  isCurrentlyEquipping: boolean;
  onEquipCape: (capeId: string) => void;
  canDelete?: boolean;
  onDeleteCapeClick?: (cape: CosmeticCape, e: React.MouseEvent) => void;
  creatorNameCache: Map<string, string>;
  onContextMenu?: (e: React.MouseEvent) => void;
}

function CapeItemDisplay({
  cape,
  imageUrl,
  isCurrentlyEquipping,
  onEquipCape,
  canDelete,
  onDeleteCapeClick,
  creatorNameCache,
  onContextMenu,
}: CapeItemDisplayProps) {
  const [creatorName, setCreatorName] = useState<string | null>(null);
  const [creatorLoading, setCreatorLoading] = useState<boolean>(false);
  const accentColor = useThemeStore((state) => state.accentColor);
  const isFavorite = useCapeFavoritesStore((s) => s.isFavorite(cape._id));
  const toggleFavoriteOptimistic = useCapeFavoritesStore((s) => s.toggleFavoriteOptimistic);

  useEffect(() => {
    let isMounted = true;
    if (cape.firstSeen) {
      if (creatorNameCache.has(cape.firstSeen)) {
        setCreatorName(creatorNameCache.get(cape.firstSeen)!);
        setCreatorLoading(false);
        return;
      }

      setCreatorLoading(true);
      getPlayerProfileByUuidOrName(cape.firstSeen)
        .then((profile) => {
          if (isMounted) {
            const nameToCache =
              profile && profile.name ? profile.name : "Unknown";
            setCreatorName(nameToCache);
            creatorNameCache.set(cape.firstSeen, nameToCache);
          }
        })
        .catch(() => {
          if (isMounted) {
            const errorNameToCache = "Error";
            setCreatorName(errorNameToCache);
            creatorNameCache.set(cape.firstSeen, errorNameToCache);
          }
        })
        .finally(() => {
          if (isMounted) {
            setCreatorLoading(false);
          }
        });
    }
    return () => {
      isMounted = false;
    };
  }, [cape.firstSeen, creatorNameCache]);

  const capeImageWidth = 140;
  const capeImageHeight = Math.round(capeImageWidth * (16 / 10));

  return (
    <Card
      className="flex flex-col items-center group cursor-pointer h-full justify-between transition-all duration-300 ease-out hover:scale-105 hover:z-10"
      onClick={() => !isCurrentlyEquipping && onEquipCape(cape._id)}
      onContextMenu={onContextMenu}
      variant="flat"
    >
      {isCurrentlyEquipping && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-md z-30">
          <Icon
            icon="solar:refresh-bold"
            className="w-10 h-10 animate-spin mb-2"
            style={{ color: accentColor.value }}
          />
          <span className="font-minecraft text-base text-white lowercase">
            Equipping
          </span>
        </div>
      )}

      <div className={cn("absolute top-1.5 z-20 transition-opacity", canDelete ? "right-7" : "right-1.5", isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleFavoriteOptimistic(cape._id);
          }}
          className="m-0"
          title={isFavorite ? "Unfavorite" : "Favorite"}
          disabled={isCurrentlyEquipping}
        >
          <Icon
            icon={isFavorite ? "ph:heart-fill" : "ph:heart"}
            className="w-5 h-5"
            style={{ color: "#ef4444" }}
          />
        </button>
      </div>

      <p
        className="font-minecraft-ten text-white lowercase truncate text-sm w-full text-center h-6 flex items-center justify-center mb-1 transition-transform duration-300 ease-out group-hover:scale-110"
        style={{ minHeight: "24px" }}
        title={creatorName || cape.firstSeen}
      >
        {creatorLoading ? "Loading..." : creatorName || "-"}
      </p>

      <div
        className="relative transition-transform duration-300 ease-out group-hover:scale-105"
        style={{ width: `${capeImageWidth}px`, height: `${capeImageHeight}px` }}
      >
        <CapeImage
          imageUrl={imageUrl}
          part="front"
          width={capeImageWidth}
          className="rounded-sm block"
        />
      </div>

      <p
        className="font-minecraft-ten text-white/70 text-xs w-full text-center mt-1 h-5 flex items-center justify-center transition-transform duration-300 ease-out group-hover:scale-110"
        title={`Used ${cape.uses.toLocaleString()} times`}
      >
        <Icon
          icon="solar:download-minimalistic-outline"
          className="w-3 h-3 mr-1 text-white/50"
        />
        {cape.uses.toLocaleString()}
      </p>

      {canDelete && onDeleteCapeClick && (
        <button
          onClick={(e) => onDeleteCapeClick(cape, e)}
          className="absolute top-1.5 right-1.5 p-0.5 bg-black/60 hover:bg-red-700/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-20 m-0"
          title="Delete Cape"
          disabled={isCurrentlyEquipping}
        >
          <Icon
            icon="solar:close-circle-bold"
            className="w-4 h-4 text-white/80 hover:text-white"
          />
        </button>
      )}
    </Card>
  );
}

interface AddCapeCardProps {
  onClick: () => void;
  onDownloadTemplate?: () => void;
}

function AddCapeCard({ onClick, onDownloadTemplate }: AddCapeCardProps) {
  const [isVisible, setIsVisible] = useState(false);
  const accentColor = useThemeStore((state) => state.accentColor);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 50); 
    return () => clearTimeout(timer);
  }, []);

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".download-template-button")) {
      return;
    }
    onClick();
  };

  return (
    <Card
      className="flex flex-col items-center justify-between group cursor-pointer h-full border-dashed relative min-h-[300px] transition-all duration-300 ease-out hover:scale-105 hover:z-10"
      onClick={handleCardClick}
      variant="flat"
    >
      <div
        className={cn(
          "flex flex-col items-center justify-center flex-grow transition-opacity duration-300 ease-in-out p-3",
          isVisible ? "opacity-100" : "opacity-0",
        )}
      >
        <Icon
          icon="solar:add-square-bold-duotone"
          className="w-16 h-16 opacity-70 group-hover:opacity-100 transition-opacity"
          style={{ color: accentColor.value }}
        />
        <p className="font-minecraft lowercase text-2xl text-white/70 mt-2 transition-transform duration-300 ease-out group-hover:scale-110">
          Add Cape
        </p>
      </div>
      {onDownloadTemplate && (
        <Button
          onClick={(e) => {
            e.stopPropagation(); 
            onDownloadTemplate();
          }}
          className="download-template-button w-full mt-2 cursor-pointer rounded-md transition-colors duration-150 group/template-btn"
          variant="ghost"
          size="md"
        >
          <div className="flex items-center justify-center gap-2">
            <Icon
              icon="solar:download-minimalistic-bold"
              className="w-4 h-4 transition-colors duration-150"
              style={{ color: accentColor.value }}
            />
            <span className="font-minecraft text-xl transition-colors duration-150 lowercase">
              TEMPLATE
            </span>
          </div>
        </Button>
      )}
    </Card>
  );
}

export const ADD_CAPE_PLACEHOLDER_ID = "__ADD_CAPE_PLACEHOLDER__";

export interface CapeListProps {
  capes: (CosmeticCape | { _id: typeof ADD_CAPE_PLACEHOLDER_ID })[];
  onEquipCape: (capeHash: string) => void;
  isLoading?: boolean;
  isEquippingCapeId?: string | null;
  searchQuery?: string;
  canDelete?: boolean;
  onDeleteCape?: (cape: CosmeticCape) => void;
  loadMoreItems?: () => void;
  hasMoreItems?: boolean;
  isFetchingMore?: boolean;
  onTriggerUpload?: () => void;
  onDownloadTemplate?: () => void;
  groupFavoritesInHeader?: boolean;
}

export function CapeList({
  capes,
  onEquipCape,
  isLoading = false,
  isEquippingCapeId = null,
  searchQuery = "",
  canDelete = false,
  onDeleteCape,
  loadMoreItems,
  hasMoreItems = false,
  isFetchingMore = false,
  onTriggerUpload,
  onDownloadTemplate,
  groupFavoritesInHeader = true,
}: CapeListProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const creatorNameCacheRef = useRef<Map<string, string>>(new Map());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    cape: CosmeticCape | null;
  } | null>(null);
  const [show3DPreview, setShow3DPreview] = useState<{
    cape: CosmeticCape;
  } | null>(null);
  const authStore = useMinecraftAuthStore();
  const activeAccount = authStore.activeAccount;
  const userSkinUrl = activeAccount?.id
    ? `https://crafatar.com/skins/${activeAccount.id}`
    : undefined;

  const [isDebouncedLoading, setIsDebouncedLoading] = useState(false);
  const debouncedLoadingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const favoriteCapeIds = useCapeFavoritesStore((s) => s.favoriteCapeIds);
  const favoriteCapes = useMemo(() => {
    const setIds = new Set(favoriteCapeIds);
    return capes
      .filter((c) => c._id !== ADD_CAPE_PLACEHOLDER_ID)
      .map((c) => c as CosmeticCape)
      .filter((c) => setIds.has(c._id));
  }, [capes, favoriteCapeIds]);

  const [favoriteCapesFetched, setFavoriteCapesFetched] = useState<Map<string, CosmeticCape>>(new Map());

  const missingFavoriteIds = useMemo(() => {
    if (!groupFavoritesInHeader) return [] as string[];
    const presentIds = new Set(favoriteCapes.map((c) => c._id));
    return favoriteCapeIds.filter((id) => !presentIds.has(id));
  }, [favoriteCapeIds, favoriteCapes, groupFavoritesInHeader]);

  useEffect(() => {
    if (!groupFavoritesInHeader) return;
    const idsToFetch = missingFavoriteIds.filter((id) => !favoriteCapesFetched.has(id));
    if (idsToFetch.length === 0) return;
    const chunk = idsToFetch.slice(0, 100);
    getCapesByHashes(chunk)
      .then((capes) => {
        setFavoriteCapesFetched((prev) => {
          const next = new Map(prev);
          capes.forEach((c) => next.set(c._id, c));
          return next;
        });
      })
      .catch((e) => {
        console.warn("[CapeList] Failed to fetch favorite capes by hashes:", e);
      });
  }, [missingFavoriteIds, favoriteCapesFetched, groupFavoritesInHeader]);

  const allFavoriteCapesForHeader = useMemo(() => {
    if (!groupFavoritesInHeader) return [] as CosmeticCape[];
    const present = favoriteCapes;
    const presentIds = new Set(present.map((c) => c._id));
    const missing = favoriteCapeIds
      .filter((id) => !presentIds.has(id))
      .map((id) => ({
        _id: id,
        uses: 0,
        firstSeen: "",
        elytra: false,
      } as unknown as CosmeticCape));
    return [...present, ...missing];
  }, [favoriteCapes, favoriteCapeIds, groupFavoritesInHeader]);

  useEffect(() => {

    const actualCapesCount = capes.filter(
      (c) => c._id !== ADD_CAPE_PLACEHOLDER_ID,
    ).length;
    const showLoadingSkeleton =
      isLoading && actualCapesCount === 0 && !searchQuery;

    if (showLoadingSkeleton) {
      if (debouncedLoadingTimerRef.current) {
        clearTimeout(debouncedLoadingTimerRef.current);
      }
      debouncedLoadingTimerRef.current = setTimeout(() => {
        setIsDebouncedLoading(true);
      }, 300);
    } else {
      if (debouncedLoadingTimerRef.current) {
        clearTimeout(debouncedLoadingTimerRef.current);
      }
      setIsDebouncedLoading(false);
    }

    return () => {
      if (debouncedLoadingTimerRef.current) {
        clearTimeout(debouncedLoadingTimerRef.current);
      }
    };
  }, [isLoading, capes, searchQuery]);

  const handleDeleteClickInternal = useCallback(
    (cape: CosmeticCape, e: React.MouseEvent) => {
      e.stopPropagation();
      if (onDeleteCape) {
        onDeleteCape(cape);
      }
    },
    [onDeleteCape],
  );

  const itemsToRender = useMemo(() => {
    const favoriteIdsSet = new Set(favoriteCapeIds);
    return capes.filter((item) => {
      if (item._id === ADD_CAPE_PLACEHOLDER_ID) return !groupFavoritesInHeader || favoriteCapes.length === 0;
      if (!groupFavoritesInHeader) return true;
      return !favoriteIdsSet.has((item as CosmeticCape)._id);
    });
  }, [capes, favoriteCapeIds, favoriteCapes.length, groupFavoritesInHeader]);

  const virtuosoComponents = useMemo(
    () => ({
      Header: () => {
        const present = favoriteCapes;
        if (!groupFavoritesInHeader) return null;
        const presentIds = new Set(present.map((c) => c._id));
        const missing = favoriteCapeIds
          .filter((id) => !presentIds.has(id))
          .map((id) => favoriteCapesFetched.get(id) ?? ({ _id: id, uses: 0, firstSeen: "", elytra: false } as unknown as CosmeticCape));
        const allFavoriteCapesForHeader = [...present, ...missing];
        if (allFavoriteCapesForHeader.length === 0) return null;
        return (
          <div className="mb-2">
            <div className="flex items-center justify-between mb-2 px-4">
              <span className="font-minecraft text-white/80 lowercase text-xl">favorites</span>
              <span className="text-white/40 text-xs font-minecraft">{allFavoriteCapesForHeader.length}</span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
                gap: "16px",
                padding: "16px",
                paddingTop: "8px",
                paddingBottom: 0,
              }}
            >
              {onTriggerUpload && (
                <AddCapeCard
                  onClick={onTriggerUpload}
                  onDownloadTemplate={onDownloadTemplate}
                />
              )}
              {allFavoriteCapesForHeader.map((cape) => {
                const imageUrl = `https://cdn.norisk.gg/capes/prod/${cape._id}.png`;
                return (
                  <CapeItemDisplay
                    key={`fav-${cape._id}`}
                    cape={cape}
                    imageUrl={imageUrl}
                    isCurrentlyEquipping={isEquippingCapeId === cape._id}
                    onEquipCape={onEquipCape}
                    canDelete={canDelete}
                    onDeleteCapeClick={handleDeleteClickInternal}
                    creatorNameCache={creatorNameCacheRef.current}
                    onContextMenu={(e) => handleCapeContextMenu(cape, e)}
                  />
                );
              })}
            </div>
            <div className="h-px w-full bg-white/10 my-4" />
          </div>
        );
      },
      Footer: () => {
        if (!isFetchingMore) return null;
        return (
          <div className="flex justify-center items-center p-4">
            <Icon
              icon="eos-icons:loading"
              className="w-8 h-8"
              style={{ color: accentColor.value }}
            />
          </div>
        );
      },
      List: ListComponent, 
    }),
    [isFetchingMore, accentColor, favoriteCapes, favoriteCapeIds, favoriteCapesFetched, isEquippingCapeId, onEquipCape, canDelete, onTriggerUpload, onDownloadTemplate, groupFavoritesInHeader],
  ); 

  function calculateMenuPosition(x: number, y: number, menuWidth: number, menuHeight: number) {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const padding = 16;
    let adjustedX = x;
    let adjustedY = y;
    if (x + menuWidth + padding > viewport.width) {
      adjustedX = x - menuWidth;
      if (adjustedX < padding) adjustedX = viewport.width - menuWidth - padding;
    }
    if (y + menuHeight + padding > viewport.height) {
      adjustedY = y - menuHeight;
      if (adjustedY < padding) adjustedY = viewport.height - menuHeight - padding;
    }
    adjustedX = Math.max(padding, Math.min(adjustedX, viewport.width - menuWidth - padding));
    adjustedY = Math.max(padding, Math.min(adjustedY, viewport.height - menuHeight - padding));
    return { x: adjustedX, y: adjustedY };
  }

  useEffect(() => {
    if (contextMenu) {
      const menuWidth = 200;
      const menuHeight = 56;
      setMenuPosition(calculateMenuPosition(contextMenu.x, contextMenu.y, menuWidth, menuHeight));
      window.addEventListener("click", () => setContextMenu(null));
      return () => window.removeEventListener("click", () => setContextMenu(null));
    }
  }, [contextMenu]);

  useEffect(() => {
    if (contextMenu && menuRef.current) {
      gsap.fromTo(
        menuRef.current,
        { opacity: 0, scale: 0.95, y: -10 },
        { opacity: 1, scale: 1, y: 0, duration: 0.18, ease: "power2.out" }
      );
    }
  }, [contextMenu]);

  const handleCapeContextMenu = useCallback(
    (cape: CosmeticCape, e: React.MouseEvent) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, cape });
    },
    []
  );

  const handlePreview3D = useCallback(() => {
    if (contextMenu?.cape) {
      setShow3DPreview({ cape: contextMenu.cape });
      setContextMenu(null);
    }
  }, [contextMenu]);

  if (isDebouncedLoading) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center h-[calc(100vh-200px)] text-white/70 transition-opacity duration-500",
          isDebouncedLoading ? "opacity-100" : "opacity-0",
        )}
      >
        <Icon
          icon="solar:hourglass-bold-duotone"
          className="w-16 h-16 mb-4 animate-pulse"
          style={{ color: accentColor.value }}
        />
        <p className="font-minecraft text-2xl lowercase">Loading Capes...</p>
      </div>
    );
  }


  const noActualCapesToDisplay =
    itemsToRender.filter((item) => item._id !== ADD_CAPE_PLACEHOLDER_ID)
      .length === 0;
  const addCapeCardIsPresent = itemsToRender.some(
    (item) => item._id === ADD_CAPE_PLACEHOLDER_ID,
  );

  if (
    !isLoading &&
    noActualCapesToDisplay &&
    !(addCapeCardIsPresent && onTriggerUpload)
  ) {
    return (
      <div className="flex-grow flex items-center justify-center p-5">
        <EmptyState
          icon="solar:hanger-wave-line-duotone"
          message={
            searchQuery
              ? `No capes found for "${searchQuery}"`
              : "No capes available"
          }
        />
      </div>
    );
  }

  const handleEndReached = () => {
    if (hasMoreItems && !isFetchingMore && loadMoreItems) {
      console.log("[CapeList] Reached end, loading more items...");
      loadMoreItems();
    } else if (!hasMoreItems) {
      console.log("[CapeList] Reached end, no more items to load.");
    }
  };

  return (
    <div
      className={cn(
        "flex-grow custom-scrollbar h-full",
        onTriggerUpload ? "" : "p-4",
      )}
    >
      <VirtuosoGrid
        style={{ height: "100%" }}
        data={itemsToRender}
        endReached={handleEndReached}
        overscan={200}
        components={virtuosoComponents}
        itemContent={(index, item) => {
          if (item._id === ADD_CAPE_PLACEHOLDER_ID) {
            if (!onTriggerUpload) return null;
            return (
              <AddCapeCard
                onClick={onTriggerUpload}
                onDownloadTemplate={onDownloadTemplate}
              />
            );
          }
          const cape = item as CosmeticCape;
          const imageUrl = `https://cdn.norisk.gg/capes/prod/${cape._id}.png`;
          return (
            <CapeItemDisplay
              key={cape._id}
              cape={cape}
              imageUrl={imageUrl}
              isCurrentlyEquipping={isEquippingCapeId === cape._id}
              onEquipCape={onEquipCape}
              canDelete={canDelete}
              onDeleteCapeClick={handleDeleteClickInternal}
              creatorNameCache={creatorNameCacheRef.current}
              onContextMenu={(e) => handleCapeContextMenu(cape, e)}
            />
          );
        }}
        className="custom-scrollbar"
      />
      {contextMenu && contextMenu.cape && (
        <div
          ref={menuRef}
          className="fixed z-[9999] rounded-md shadow-xl border-2 border-b-4 overflow-hidden"
          style={{
            top: menuPosition.y,
            left: menuPosition.x,
            backgroundColor: accentColor.value + "20",
            borderColor: accentColor.value + "90",
            borderBottomColor: accentColor.value,
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            boxShadow: "0 8px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05)",
          }}
          onClick={e => e.stopPropagation()}
        >
          <span
            className="absolute inset-x-0 top-0 h-[2px] rounded-t-sm"
            style={{ backgroundColor: `${accentColor.value}80` }}
          />
          <ul className="py-1">
            <li
              className="px-4 py-2.5 flex items-center gap-3 hover:bg-white/10 cursor-pointer transition-colors duration-150"
              onClick={handlePreview3D}
            >
              <Icon icon="ph:eye-bold" className="w-5 h-5 text-white" />
              <span className="font-minecraft-ten text-base text-white/80">
                Preview
              </span>
            </li>
          </ul>
        </div>
      )}
      {show3DPreview && (
        <Modal
          title="3D Skin Preview"
          onClose={() => setShow3DPreview(null)}
          width="lg"
          variant="flat"
        >
          <Cape3DPreviewWithToggle
            skinUrl={userSkinUrl}
            capeId={show3DPreview.cape._id}
          />
        </Modal>
      )}
    </div>
  );
}

function Cape3DPreviewWithToggle({ skinUrl, capeId }: { skinUrl?: string; capeId: string }) {
  const [showElytra, setShowElytra] = useState(false);
  return (
    <div style={{ width: 300, height: 380, margin: "0 auto", position: "relative" }}>
      <IconButton
        onClick={() => setShowElytra((v) => !v)}
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 z-10"
        icon={
          <Icon
            icon={showElytra ? "ph:airplane-tilt-fill" : "ph:airplane-tilt-duotone"}
            className="w-5 h-5"
          />
        }
        title={showElytra ? "Show as Cape" : "Show as Elytra"}
        aria-label={showElytra ? "Show as Cape" : "Show as Elytra"}
      />
      <SkinView3DWrapper
        skinUrl={skinUrl}
        capeUrl={`https://cdn.norisk.gg/capes/prod/${capeId}.png`}
        enableAutoRotate={true}
        autoRotateSpeed={0.5}
        startFromBack={true}
        zoom={0.9}
        displayAsElytra={showElytra}
        width={300}
        height={380}
      />
    </div>
  );
}
