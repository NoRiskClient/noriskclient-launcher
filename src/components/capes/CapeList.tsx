import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useInView } from "react-intersection-observer";
import type { CosmeticCape } from "../../types/noriskCapes";
import type { VanillaCape } from "../../types/vanillaCapes";
import { EmptyState } from "../ui/EmptyState";
import { SignedOutState } from "../account/SignedOutState";
import { Icon } from "@iconify/react";
import { CapeImage } from "./CapeImage";
import { VanillaCapeImage } from "./VanillaCapeImage";
import { Tooltip } from "../ui/Tooltip";
import { getCapesByHashes, getCapeImageUrl, getCapeReviewImageUrl } from "../../services/cape-service";
import { useThemeStore } from "../../store/useThemeStore";
import { cn } from "../../lib/utils";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { useCapeFavoritesStore } from "../../store/useCapeFavoritesStore";
import type { CapeReviewState } from "../../types/noriskCapes";
import { NO_CAPE_ID } from "./noCape";
import { CardContextMenu, useCardContextMenu } from "../ui/CardContextMenu";
import type { ContextMenuItem } from "../ui/SettingsContextMenu";

function getCapeReviewState(cape: CosmeticCape): CapeReviewState {
  if (cape.accepted) return 'ACCEPTED';
  if (cape.moderatorMessage === 'In Review') return 'IN_REVIEW';
  return 'DENIED';
}

interface CapeItemDisplayProps {
  cape: CosmeticCape | VanillaCape;
  imageUrl: string;
  isCurrentlyEquipping: boolean;
  isEquipped?: boolean;
  isSelected?: boolean;
  onSelect: (selection: CapeSelection) => void;
  onOpenMenu?: (cape: CosmeticCape | VanillaCape, event: React.MouseEvent) => void;
  canDelete?: boolean;
  onDeleteCapeClick?: (cape: CosmeticCape | VanillaCape, e: React.MouseEvent) => void;
  isVanilla?: boolean;
  showReviewState?: boolean;
  isExperimental?: boolean;
  isModerator?: boolean;
  onModeratorDeleteClick?: (cape: CosmeticCape, e: React.MouseEvent) => void;
}

const CapeItemDisplay = memo(function CapeItemDisplay({
  cape,
  imageUrl,
  isCurrentlyEquipping,
  isEquipped = false,
  isSelected = false,
  onSelect,
  onOpenMenu,
  canDelete,
  onDeleteCapeClick,
  isVanilla = false,
  showReviewState = false,
  isExperimental = false,
  isModerator = false,
  onModeratorDeleteClick,
}: CapeItemDisplayProps) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const accentColor = useThemeStore((state) => state.accentColor);
  const capeState = !isVanilla ? getCapeReviewState(cape as CosmeticCape) : 'ACCEPTED';
  const isDenied = capeState === 'DENIED';
  const isInReview = capeState === 'IN_REVIEW';
  const capeId = isVanilla ? (cape as VanillaCape).id : (cape as CosmeticCape)._id;
  const isNoCape = capeId === NO_CAPE_ID;

  const handleCapeClick = () => {
    if (isCurrentlyEquipping || isDenied) return;
    onSelect({
      capeId,
      capeUrl: isNoCape
        ? null
        : isVanilla
          ? (cape as VanillaCape).url
          : isInReview
            ? getCapeReviewImageUrl(capeId, isExperimental)
            : getCapeImageUrl(capeId, isExperimental),
      uses: isNoCape || isVanilla ? null : (cape as CosmeticCape).uses,
    });
  };

  const isFavorite = useCapeFavoritesStore((s) =>
    isVanilla ? false : s.isFavorite((cape as CosmeticCape)._id)
  );
  const toggleFavoriteOptimistic = useCapeFavoritesStore((s) => s.toggleFavoriteOptimistic);


  const displayWidth = 96;
  const displayHeight = Math.round(displayWidth * (16 / 10));

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-3 p-4 rounded-lg bg-black/20 border border-white/10 hover:border-white/20 transition-all duration-200",
        isDenied ? "cursor-default opacity-60" : "cursor-pointer"
      )}
      style={isSelected ? { borderColor: accentColor.value, backgroundColor: `${accentColor.value}20` } : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={(e) => { e.preventDefault(); handleCapeClick(); }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (isDenied || isNoCape) return;
        onOpenMenu?.(cape, e);
      }}
    >
      <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
        {!isVanilla && !isNoCape && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleFavoriteOptimistic((cape as CosmeticCape)._id);
            }}
            className="w-8 h-8 flex items-center justify-center bg-black/30 hover:bg-black/50 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded transition-all duration-200"
            title={isFavorite ? t('capes.unfavorite') : t('capes.favorite')}
            disabled={isCurrentlyEquipping}
          >
            <Icon
              icon={isFavorite ? "ph:heart-fill" : "ph:heart"}
              className="w-4 h-4"
              style={{ color: isFavorite ? "#ef4444" : undefined }}
            />
          </button>
        )}

        {canDelete && onDeleteCapeClick && !isVanilla && !isNoCape && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDeleteCapeClick(cape as CosmeticCape, e);
            }}
            className="w-8 h-8 flex items-center justify-center bg-black/30 hover:bg-red-700/80 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded transition-all duration-200"
            title={t('capes.deleteCape')}
            disabled={isCurrentlyEquipping}
          >
            <Icon icon="solar:trash-bin-trash-bold" className="w-4 h-4" />
          </button>
        )}

      </div>

      {isModerator && onModeratorDeleteClick && !isVanilla && !isNoCape && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onModeratorDeleteClick(cape as CosmeticCape, e);
          }}
          className="absolute bottom-3 right-3 z-20 w-7 h-7 flex items-center justify-center rounded-full bg-red-500/20 hover:bg-red-500/60 text-red-400 hover:text-white border border-red-500/30 hover:border-red-400 backdrop-blur-sm transition-all duration-200 opacity-0 group-hover:opacity-100"
          title={t('capes.moderatorDelete')}
          disabled={isCurrentlyEquipping}
        >
          <Icon icon="solar:trash-bin-trash-bold" className="w-3.5 h-3.5" />
        </button>
      )}

      <div className="flex flex-col items-center gap-3 relative z-10 w-full">
        <div
          className="relative flex-shrink-0 rounded-lg flex items-center justify-center overflow-hidden border-2 transition-all duration-300 ease-out"
          style={{
            width: `${displayWidth}px`,
            height: `${displayHeight}px`,
            backgroundColor: isHovered ? `${accentColor.value}20` : 'transparent',
            borderColor: isEquipped ? accentColor.value : (isHovered ? `${accentColor.value}60` : 'transparent'),
          }}
        >
          {(() => {
            if (isVanilla) {
              return <VanillaCapeImage imageUrl={imageUrl} width={displayWidth} className="rounded-sm block" />;
            }
            const cosmeticCape = cape as CosmeticCape;
            if (isNoCape) {
              return <div className="w-full h-full flex items-center justify-center bg-white/5">
                <Icon icon="solar:close-circle-bold-duotone" className="w-10 h-10 text-white/20" />
              </div>;
            }
            if (isInReview) {
              return <CapeImage imageUrl={getCapeReviewImageUrl(cosmeticCape._id, isExperimental)} part="front" width={displayWidth} className="rounded-sm block" />;
            }
            if (isDenied) {
              return cosmeticCape.blurHash
                ? <CapeImage imageUrl={cosmeticCape.blurHash} part="front" width={displayWidth} className="rounded-sm block blur-sm" />
                : <div className="w-full h-full flex items-center justify-center bg-white/5">
                    <Icon icon="solar:close-circle-bold-duotone" className="w-10 h-10 text-white/20" />
                  </div>;
            }
            return <CapeImage imageUrl={imageUrl} part="front" width={displayWidth} className="rounded-sm block" />;
          })()}

          {isEquipped && !isCurrentlyEquipping && (
            <div className="absolute top-2 right-2 z-30">
              <Tooltip content={t('capes.currentlyEquipped')}>
                <Icon
                  icon="solar:check-circle-bold"
                  className="w-4 h-4"
                  style={{ color: accentColor.value }}
                />
              </Tooltip>
            </div>
          )}

          {isCurrentlyEquipping && (
            <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-lg">
              <Icon
                icon="svg-spinners:ring-resize"
                className="w-8 h-8 mb-1"
                style={{ color: accentColor.value }}
              />
              <span className="font-smallcaps text-xs text-white">
                {t('capes.equipping')}
              </span>
            </div>
          )}

          {showReviewState && (isInReview || isDenied) && (
            <div className={cn(
              "absolute bottom-0 inset-x-0 z-20 flex items-center justify-center gap-1.5 py-1.5 backdrop-blur-sm",
              isInReview
                ? "bg-yellow-500/20 border-t border-yellow-500/30"
                : "bg-red-500/20 border-t border-red-500/30"
            )}>
              {isDenied ? (
                <Tooltip content={(cape as CosmeticCape).moderatorMessage}>
                  <div className="flex items-center gap-1.5">
                    <Icon icon="solar:close-circle-bold" className="w-4 h-4 text-red-400" />
                    <span className="text-[11px] font-minecraft lowercase text-red-400">{t('capes.denied')}</span>
                  </div>
                </Tooltip>
              ) : (
                <>
                  <Icon icon="solar:clock-circle-bold" className="w-4 h-4 text-yellow-400" />
                  <span className="text-[11px] font-minecraft lowercase text-yellow-400">{t('capes.inReview')}</span>
                </>
              )}
            </div>
          )}

        </div>

        <div className="flex-grow min-w-0 w-full text-center">
          {(isVanilla || isNoCape) && (
            <h3
              className={cn(
                "font-minecraft text-white text-base whitespace-nowrap overflow-hidden text-ellipsis max-w-full normal-case",
                isNoCape && !isVanilla ? "mt-2.5" : "mb-1"
              )}
              title={isVanilla ? (cape as VanillaCape).name : t('capes.noCape')}
            >
              {isVanilla ? (cape as VanillaCape).name : t('capes.noCape')}
            </h3>
          )}

          {!isVanilla && !isNoCape && (
            <div className="flex items-center justify-center gap-2 text-xs font-minecraft">
              <div className="text-white/60 flex items-center gap-1">
                <Icon
                  icon="solar:download-minimalistic-outline"
                  className="w-3 h-3 text-white/50"
                />
                <span title={t('capes.usesCount', { formattedCount: (cape as CosmeticCape).uses.toLocaleString() })}>
                  {(cape as CosmeticCape).uses.toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});


export interface CapeSelection {
  capeId: string;
  capeUrl: string | null;
  uses: number | null;
}

export interface CapeListProps {
  capes: CosmeticCape[] | VanillaCape[];
  onSelectCape: (selection: CapeSelection) => void;
  onEquipCape: (capeId: string) => void;
  selectedCapeId?: string | null;
  isLoading?: boolean;
  isEquippingCapeId?: string | null;
  equippedCapeId?: string | null;
  searchQuery?: string;
  canDelete?: boolean;
  onDeleteCape?: (cape: CosmeticCape) => void;
  loadMoreItems?: () => void;
  hasMoreItems?: boolean;
  isFetchingMore?: boolean;
  onTriggerUpload?: () => void;
  onDownloadTemplate?: () => void;
  groupFavoritesInHeader?: boolean;
  showFavoritesOnly?: boolean;
  isVanilla?: boolean;
  showReviewState?: boolean;
  isExperimental?: boolean;
  isModerator?: boolean;
  onModeratorDeleteCape?: (cape: CosmeticCape) => void;
}

export function CapeList({
  capes,
  onSelectCape,
  onEquipCape,
  selectedCapeId = null,
  isLoading = false,
  isEquippingCapeId = null,
  equippedCapeId = null,
  searchQuery = "",
  canDelete = false,
  onDeleteCape,
  loadMoreItems,
  hasMoreItems = false,
  isFetchingMore = false,
  onTriggerUpload,
  onDownloadTemplate,
  groupFavoritesInHeader = true,
  showFavoritesOnly = false,
  isVanilla = false,
  showReviewState = false,
  isExperimental = false,
  isModerator = false,
  onModeratorDeleteCape,
}: CapeListProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const { t } = useTranslation();
  const authStore = useMinecraftAuthStore();
  const activeAccount = authStore.activeAccount;

  const [hasInitiallyLoaded, setHasInitiallyLoaded] = useState(false);

  const favoriteCapeIds = useCapeFavoritesStore((s) => s.favoriteCapeIds);
  const [favoriteCapesFetched, setFavoriteCapesFetched] = useState<Map<string, CosmeticCape>>(new Map());

  const favoriteCapes = useMemo(() => {
    if (isVanilla) return []; // Vanilla capes don't have favorites

    // Simple approach: Filter available capes that are marked as favorites
    const result = (capes as CosmeticCape[]).filter(cape => favoriteCapeIds.includes(cape._id));

    // Also include any fetched favorites that aren't in the main capes list
    const fetchedFavorites = Array.from(favoriteCapesFetched.values()).filter(
      cape => !capes.some(c => (c as CosmeticCape)._id === cape._id)
    );

    return [...result, ...fetchedFavorites];
  }, [favoriteCapeIds, favoriteCapesFetched, capes, isVanilla]); // Keep capes dependency but optimize the calculation

  const missingFavoriteIds = useMemo(() => {
    // Always fetch missing favorites, regardless of groupFavoritesInHeader
    // Don't include placeholders in the check
    const presentIds = new Set(capes.map((c) => c._id));
    const fetchedIds = new Set(favoriteCapesFetched.keys());
    return favoriteCapeIds.filter((id) => !presentIds.has(id) && !fetchedIds.has(id));
  }, [favoriteCapeIds, capes, favoriteCapesFetched]);

  useEffect(() => {
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
  }, [missingFavoriteIds, favoriteCapesFetched]);

  // Separate state for stable favorites display - completely independent of capes loading
  const [stableFavoriteCapes, setStableFavoriteCapes] = useState<CosmeticCape[]>([]);

  // Update stable favorites only when favorite data actually changes, not when main capes change
  useEffect(() => {
    if (favoriteCapeIds.length === 0 || isVanilla) {
      setStableFavoriteCapes([]);
      return;
    }

    // Use favoriteCapes directly since it already contains the correct data from both sources
    // If we don't have all favorites yet, they will be fetched and added to favoriteCapesFetched
    const result: CosmeticCape[] = [];

    for (const id of favoriteCapeIds) {
      let cape = favoriteCapes.find(c => c._id === id);

      // If not in favoriteCapes but in fetched map, use that
      if (!cape) {
        cape = favoriteCapesFetched.get(id);
      }

      // If still not found, create placeholder (will be replaced when fetched)
      if (!cape) {
        cape = {
          _id: id,
          uses: 0,
          firstSeen: "",
          elytra: false,
        } as CosmeticCape;
      }

      result.push(cape);
    }

    setStableFavoriteCapes(result);
  }, [favoriteCapeIds, favoriteCapes, favoriteCapesFetched, isVanilla]); // Always update favorites


  // Track if we've ever loaded capes successfully (for EmptyState logic)
  useEffect(() => {
    if (!isLoading && !hasInitiallyLoaded) {
      // For favorites mode, only consider it loaded if we actually have capes available to filter from
      const hasContent = showFavoritesOnly
        ? capes.length > 0 // Only loaded if we have capes to filter favorites from
        : capes.length > 0;

      if (hasContent) {
        setHasInitiallyLoaded(true);
      }
    }
  }, [isLoading, capes.length, showFavoritesOnly, hasInitiallyLoaded]);

  // Reset hasInitiallyLoaded when switching tabs
  useEffect(() => {
    setHasInitiallyLoaded(false);
  }, [showFavoritesOnly]);

  // No loading spinner - capes appear immediately when available

  const itemsToRender = useMemo(() => {
    // If showing favorites only, return only favorites
    if (showFavoritesOnly) {
      return stableFavoriteCapes;
    }

    if (!groupFavoritesInHeader) return capes;
    // Since favorites are now rendered separately above Virtuoso, always filter them out
    if (stableFavoriteCapes.length === 0 || isVanilla) return capes;
    const favoriteIdsSet = new Set(stableFavoriteCapes.map(cape => cape._id));
    return (capes as CosmeticCape[]).filter((item) => !favoriteIdsSet.has(item._id));
  }, [capes, stableFavoriteCapes, groupFavoritesInHeader, showFavoritesOnly]);

// Removed virtuosoComponents - using native scrolling grid instead 

  const latestHandlers = useRef({ onDeleteCape, onModeratorDeleteCape, isVanilla });
  latestHandlers.current = { onDeleteCape, onModeratorDeleteCape, isVanilla };

  const toggleFavorite = useCapeFavoritesStore((s) => s.toggleFavoriteOptimistic);
  const { menu: capeMenu, open: openMenu, close: closeCapeMenu } = useCardContextMenu<CosmeticCape | VanillaCape>();
  const capeIdOf = (cape: CosmeticCape | VanillaCape) => (isVanilla ? (cape as VanillaCape).id : (cape as CosmeticCape)._id);
  const capeMenuItems: ContextMenuItem<CosmeticCape | VanillaCape>[] = [
    {
      id: "equip",
      label: t("capes.equipCape"),
      icon: "solar:check-circle-bold",
      disabled: !!capeMenu && capeIdOf(capeMenu.target) === equippedCapeId,
      onClick: (cape) => onEquipCape(capeIdOf(cape)),
    },
    ...(isVanilla
      ? []
      : [
          {
            id: "favorite",
            label: capeMenu && favoriteCapeIds.includes(capeIdOf(capeMenu.target)) ? t("capes.unfavorite") : t("capes.favorite"),
            icon: "solar:heart-bold",
            onClick: (cape: CosmeticCape | VanillaCape) => void toggleFavorite(capeIdOf(cape)),
          },
        ]),
    ...(canDelete && onDeleteCape
      ? [
          {
            id: "delete",
            label: t("capes.deleteCape"),
            icon: "solar:trash-bin-trash-bold",
            destructive: true,
            separator: true,
            onClick: (cape: CosmeticCape | VanillaCape) => latestHandlers.current.onDeleteCape?.(cape as CosmeticCape),
          },
        ]
      : []),
  ];
  const openCapeMenu = useCallback(
    (cape: CosmeticCape | VanillaCape, event: React.MouseEvent) => openMenu(cape, event),
    [openMenu],
  );

  const handleDeleteClickInternal = useCallback(
    (cape: CosmeticCape | VanillaCape, e: React.MouseEvent) => {
      e.stopPropagation();
      const { onDeleteCape, isVanilla } = latestHandlers.current;
      if (onDeleteCape && !isVanilla) {
        onDeleteCape(cape as CosmeticCape);
      }
    },
    [],
  );

  const handleModeratorDeleteClickInternal = useCallback(
    (cape: CosmeticCape, e: React.MouseEvent) => {
      e.stopPropagation();
      latestHandlers.current.onModeratorDeleteCape?.(cape);
    },
    [],
  );

  // No loading spinner - capes appear immediately when available


  const noActualCapesToDisplay = itemsToRender.length === 0;

  // For favorites, don't show loading state since favorites are filtered from available capes
  // Just show the filtered results immediately

  // Signed out, the cape list can only ever be empty, and "no capes available"
  // reads as a fault rather than as a precondition. Say what is actually
  // missing instead.
  if (!isLoading && noActualCapesToDisplay && !activeAccount) {
    return (
      <div className="flex-1 h-full flex items-center justify-center p-5">
        <SignedOutState
          icon="solar:hanger-2-line-duotone"
          title={t('capes.signedOut.title')}
          description={t('capes.signedOut.description')}
        />
      </div>
    );
  }

  if (!isLoading && noActualCapesToDisplay && hasInitiallyLoaded) {
    return (
      <div className="flex-grow flex items-center justify-center p-5">
        <EmptyState
          icon="solar:hanger-2-line-duotone"
          message={
            isVanilla
              ? searchQuery
                ? t('capes.noVanillaCapesFoundForSearch', { query: searchQuery })
                : t('capes.noVanillaCapesOwned')
              : showFavoritesOnly
              ? t('capes.markFavoritesHint')
              : searchQuery
              ? t('capes.noCapesFoundForSearch', { query: searchQuery })
              : t('capes.noCapesAvailable')
          }
        />
      </div>
    );
  }

  // Load more trigger component for intersection observer
  const LoadMoreTrigger = () => {
    const { ref, inView } = useInView({
      threshold: 0,
      rootMargin: '500px', // Load more when 500px from bottom - even earlier!
    });

    useEffect(() => {
      if (inView && hasMoreItems && !isFetchingMore && loadMoreItems) {
        console.log("[CapeList] Load more trigger activated, loading more items...");
        loadMoreItems();
      }
    }, [inView, hasMoreItems, isFetchingMore, loadMoreItems]);

    if (!hasMoreItems) return null;

    return (
      <div ref={ref} className="flex justify-center items-center p-8">
        {isFetchingMore ? (
          <Icon
            icon="svg-spinners:ring-resize"
            className="w-8 h-8"
            style={{ color: accentColor.value }}
          />
        ) : (
          <div className="w-full h-4" /> // Invisible trigger area
        )}
      </div>
    );
  };

  return (
    <div
      className={cn(
        "flex-grow custom-scrollbar h-full",
        onTriggerUpload ? "" : "p-4",
      )}
    >
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Render favorites separately above native grid to prevent flickering */}
        {groupFavoritesInHeader && stableFavoriteCapes.length > 0 && !showFavoritesOnly && !isVanilla && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(128px, 1fr))",
              gap: "16px",
              padding: "16px",
            }}
          >
            {stableFavoriteCapes.map((cape) => {
              const imageUrl = getCapeImageUrl(cape._id, isExperimental);
              return (
                <CapeItemDisplay
                  key={`fav-${cape._id}`}
                  cape={cape}
                  imageUrl={imageUrl}
                  isCurrentlyEquipping={isEquippingCapeId === cape._id}
                  isEquipped={false}
                  isSelected={selectedCapeId === cape._id}
                  onSelect={onSelectCape}
                  onOpenMenu={openCapeMenu}
                  canDelete={canDelete}
                  onDeleteCapeClick={handleDeleteClickInternal}
                  isVanilla={isVanilla}
                  isExperimental={isExperimental}
                  isModerator={isModerator}
                  onModeratorDeleteClick={handleModeratorDeleteClickInternal}
                />
              );
            })}
          </div>
        )}

        {/* Native scrolling grid - similar to ScreenshotsTab */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(128px, 1fr))",
              gap: "16px",
              padding: "16px",
          }}
        >
          {itemsToRender.map((cape) => {
            const imageUrl = isVanilla
              ? (cape as VanillaCape).url
              : getCapeImageUrl((cape as CosmeticCape)._id, isExperimental);
            const capeId = isVanilla ? (cape as VanillaCape).id : (cape as CosmeticCape)._id;
            const isEquipped = equippedCapeId === capeId;
            return (
              <CapeItemDisplay
                key={`${isVanilla ? "vanilla" : "norisk"}-${capeId}`}
                cape={cape}
                imageUrl={imageUrl}
                isCurrentlyEquipping={isEquippingCapeId === capeId}
                isEquipped={isEquipped}
                isSelected={selectedCapeId === capeId}
                onSelect={onSelectCape}
                onOpenMenu={openCapeMenu}
                canDelete={canDelete && !isVanilla}
                onDeleteCapeClick={handleDeleteClickInternal}
                isVanilla={isVanilla}
                showReviewState={showReviewState}
                isExperimental={isExperimental}
                isModerator={isModerator}
                onModeratorDeleteClick={handleModeratorDeleteClickInternal}
              />
            );
          })}

          {/* Load more trigger - only for non-favorites modes */}
          {!showFavoritesOnly && <LoadMoreTrigger />}
          </div>
        </div>
      </div>

      <CardContextMenu menu={capeMenu} items={capeMenuItems} onClose={closeCapeMenu} />
    </div>
  );
}


