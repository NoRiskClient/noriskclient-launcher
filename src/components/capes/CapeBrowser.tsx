"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  browseCapes,
  downloadTemplateAndOpenExplorer,
  equipCape,
  getPlayerCapes,
  unequipCape,
} from "../../services/cape-service";
import type {
  BrowseCapesOptions,
  CosmeticCape,
  GetPlayerCapesPayloadOptions,
  PaginationInfo,
} from "../../types/noriskCapes";
import { CapeList } from "./CapeList";
import type { CapeFiltersData } from "./CapeFilters";
import { Icon } from "@iconify/react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Modal } from "../ui/Modal";
import { SkinView3DWrapper } from "../common/SkinView3DWrapper";
import { Button } from "../ui/buttons/Button";
import { IconButton } from "../ui/buttons/IconButton";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { SearchWithFilters } from "../ui/SearchWithFilters";
import { useThemeStore } from "../../store/useThemeStore";
import { useCapeFavoritesStore } from "../../store/useCapeFavoritesStore";
import { useVanillaCapeStore } from "../../store/useVanillaCapeStore";
import type { VanillaCape } from "../../types/vanillaCapes";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { preloadIcons } from "../../lib/icon-utils";
import { deleteCape } from "../../services/cape-service";
import { toast } from "react-hot-toast";
import { UploadCapeModal } from "./UploadCapeModal";
import { ConfirmDeletionModal } from "./ConfirmDeletionModal";
import { translateCapeError, isCapeInReview } from "../../utils/cape-error-translations";



export function CapeBrowser(): JSX.Element {
  const { t } = useTranslation();
  // Separate state for ALL capes and MY CAPES
  const [allCapes, setAllCapes] = useState<CosmeticCape[]>([]);
  const [myCapes, setMyCapes] = useState<CosmeticCape[]>([]);
  const [allPagination, setAllPagination] = useState<PaginationInfo | null>(null);
  const [myPagination, setMyPagination] = useState<PaginationInfo | null>(null);
  // Separate loading states for ALL and MY CAPES
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [isLoadingMy, setIsLoadingMy] = useState(false);
  const [isFetchingMoreAll, setIsFetchingMoreAll] = useState(false);
  const [isFetchingMoreMy, setIsFetchingMoreMy] = useState(false);
  const [isEquippingCapeId, setIsEquippingCapeId] = useState<string | null>(
    null,
  );
  const [isUploading, setIsUploading] = useState(false);
  const [isUnequipping, setIsUnequipping] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [filters, setFilters] = useState<CapeFiltersData>({
    sortBy: "",
    timeFrame: "",
    showOwnedOnly: false,
    showFavoritesOnly: false,
    showVanillaOnly: false,
  });
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Helper functions to get correct setters based on current filter
  const getCapesSetter = (showOwnedOnly: boolean) =>
    showOwnedOnly ? setMyCapes : setAllCapes;
  const getPaginationSetter = (showOwnedOnly: boolean) =>
    showOwnedOnly ? setMyPagination : setAllPagination;

  const accentColor = useThemeStore((state) => state.accentColor);
  const { favoriteCapeIds, isFavorite } = useCapeFavoritesStore();
  const { ownedCapes: vanillaCapes, isLoading: isLoadingVanilla, error: vanillaError, fetchOwnedCapes, equippedCape } = useVanillaCapeStore();

  // Computed loading states based on current filter or search
  const isLoading = useMemo(() => {
    // When searching, always use all loading state
    if (searchQuery && searchQuery.trim() !== "") {
      return isLoadingAll;
    }
    if (filters.showVanillaOnly) {
      return isLoadingVanilla;
    }
    return filters.showOwnedOnly ? isLoadingMy : isLoadingAll;
  }, [filters.showOwnedOnly, filters.showVanillaOnly, isLoadingMy, isLoadingAll, isLoadingVanilla, searchQuery]);

  const isFetchingMore = useMemo(() => {
    // When searching, always use all fetching state
    if (searchQuery && searchQuery.trim() !== "") {
      return isFetchingMoreAll;
    }
    if (filters.showVanillaOnly) {
      return false; // Vanilla capes don't have pagination
    }
    return filters.showOwnedOnly ? isFetchingMoreMy : isFetchingMoreAll;
  }, [filters.showOwnedOnly, filters.showVanillaOnly, isFetchingMoreMy, isFetchingMoreAll, searchQuery]);

  // Computed equipped cape ID based on current tab
  const equippedCapeId = useMemo(() => {
    if (filters.showVanillaOnly) {
      return equippedCape?.id || null;
    }
    // For NoRisk capes, we don't have equipped state yet
    return null;
  }, [filters.showVanillaOnly, equippedCape]);

  const { showModal, hideModal } = useGlobalModal();

  // Computed current data based on filter
  const capesData = useMemo(() => {
    // For vanilla capes, filter by search query if present
    if (filters.showVanillaOnly) {
      let filteredCapes = vanillaCapes;

      if (searchQuery && searchQuery.trim() !== "") {
        const query = searchQuery.trim().toLowerCase();
        filteredCapes = vanillaCapes.filter(cape =>
          cape.name.toLowerCase().includes(query)
        );
      }

      // Add "No Cape" option at the beginning
      const hasEquippedCape = vanillaCapes.some(cape => cape.equipped);
      const noCapeOption: VanillaCape = {
        id: "no-cape",
        name: t('capes.noCape'),
        description: t('capes.removeEquippedCape'),
        url: "", // Empty URL for no cape
        equipped: !hasEquippedCape, // Equipped if no other cape is equipped
        category: "special",
        active: !hasEquippedCape, // Active if no other cape is equipped
      };

      return [noCapeOption, ...filteredCapes];
    }

    // When searching NoRisk capes, always show search results from allCapes
    if (searchQuery && searchQuery.trim() !== "") {
      return allCapes;
    }

    // For favorites, let CapeList handle the filtering - just provide all available capes
    return filters.showOwnedOnly ? myCapes : allCapes;
  }, [filters.showOwnedOnly, filters.showVanillaOnly, myCapes, allCapes, vanillaCapes, favoriteCapeIds, searchQuery]); // Add searchQuery to trigger re-render when search changes

  const paginationInfo = useMemo(() => {
    // When searching, always use allPagination for search results
    if (searchQuery && searchQuery.trim() !== "") {
      return allPagination;
    }
    if (filters.showFavoritesOnly || filters.showVanillaOnly) {
      return null; // Favorites and vanilla capes don't need pagination
    }
    return filters.showOwnedOnly ? myPagination : allPagination;
  }, [filters.showOwnedOnly, filters.showFavoritesOnly, filters.showVanillaOnly, myPagination, allPagination, searchQuery]);

  // Filter options for SearchWithFilters
  const sortOptions = [
    { value: "mostUsed", label: t('capes.mostUsed'), icon: "solar:heart-bold" },
    { value: "newest", label: t('capes.newest'), icon: "solar:sort-by-time-linear" },
    { value: "oldest", label: t('capes.oldest'), icon: "mdi:arrow-up-bold-circle-outline" },
  ];

  const filterOptions = [
    { value: "", label: t('capes.allTime'), icon: "solar:calendar-mark-linear" },
    { value: "weekly", label: t('capes.weekly'), icon: "mdi:calendar-week-outline" },
    { value: "monthly", label: t('capes.monthly'), icon: "solar:calendar-date-linear" },
  ];

  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewImagePath, setPreviewImagePath] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [showElytraPreview, setShowElytraPreview] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);


  // Helper function to format and translate error messages
  const formatErrorMessage = (error: string): string => {
    return translateCapeError(error);
  };

  // Helper function to determine if error is a warning (cape in review)
  const isWarningMessage = (error: string): boolean => {
    return isCapeInReview(error);
  };


  const fileInputRef = useRef<HTMLInputElement>(null);
  const isLoadingRef = useRef(false);
  const { activeAccount } = useMinecraftAuthStore();

  useEffect(() => {
    preloadIcons(["solar:add-square-bold-duotone"]);
  }, []);

  // Initial load for ALL capes
  useEffect(() => {
    const loadAllCapes = async () => {
      if (allCapes.length > 0 || isLoadingAll) return;

      try {
        setIsLoadingAll(true);
        const browseOptions: BrowseCapesOptions = {
          page: 0,
          page_size: 20,
          sort_by: undefined,
          time_frame: undefined,
        };
        const response = await browseCapes(browseOptions);
        setAllCapes(response.capes);
        setAllPagination(response.pagination);
      } catch (error) {
        console.error("Failed to load ALL capes:", error);
      } finally {
        setIsLoadingAll(false);
      }
    };

    loadAllCapes();
  }, []); // Only run once on mount

  // Load MY capes when account becomes available
  useEffect(() => {
    const loadMyCapes = async () => {
      if (!activeAccount || myCapes.length > 0 || isLoadingMy) return;

      try {
        setIsLoadingMy(true);
        const playerCapesOptions: GetPlayerCapesPayloadOptions = {
          player_identifier: activeAccount.id,
        };
        const response = await getPlayerCapes(playerCapesOptions);
        setMyCapes(response);
        setMyPagination({
          currentPage: 0,
          pageSize: response.length,
          totalItems: response.length,
          totalPages: 1,
        });
      } catch (error) {
        console.error("Failed to load MY capes:", error);
      } finally {
        setIsLoadingMy(false);
      }
    };

    loadMyCapes();
  }, [activeAccount]); // Run when activeAccount changes

  // Load VANILLA capes when account becomes available and vanilla tab is active
  useEffect(() => {
    if (activeAccount && filters.showVanillaOnly && vanillaCapes.length === 0 && !isLoadingVanilla && !vanillaError) {
      fetchOwnedCapes();
    }
  }, [activeAccount, filters.showVanillaOnly, vanillaCapes.length, isLoadingVanilla, vanillaError, fetchOwnedCapes]);

  const hasMoreItems = useMemo(() => {
    // Search results and vanilla capes don't have pagination
    if (searchQuery && searchQuery.trim() !== "" || filters.showVanillaOnly) {
      return false;
    }
    return paginationInfo
      ? paginationInfo.currentPage < paginationInfo.totalPages - 1
      : false;
  }, [paginationInfo, searchQuery, filters.showVanillaOnly]);

  const fetchCapesData = useCallback(
    async (
      pageToFetch: number,
      currentFilters: CapeFiltersData,
      currentSearchQuery: string,
      append = false,
    ) => {
      // Prevent concurrent requests
      if (isLoadingRef.current) {
        return;
      }

      isLoadingRef.current = true;

      if (append) {
        if (currentFilters.showOwnedOnly) {
          setIsFetchingMoreMy(true);
        } else {
          setIsFetchingMoreAll(true);
        }
      } else {
        if (currentFilters.showOwnedOnly) {
          setIsLoadingMy(true);
        } else {
          setIsLoadingAll(true);
        }
      }

      try {
        let response;
        const currentActiveAccount = useMinecraftAuthStore.getState().activeAccount;

        // Priority: Search > Owned Only > Browse All
        if (currentSearchQuery && currentSearchQuery.trim() !== "") {
          // Search for player capes - this should work regardless of current tab
          const playerCapesOptions: GetPlayerCapesPayloadOptions = {
            player_identifier: currentSearchQuery.trim(),
          };
          response = await getPlayerCapes(playerCapesOptions);

          // Always use the "all" setters for search results since we're searching globally
          setAllCapes(response);
          setAllPagination({
            currentPage: 0,
            pageSize: response.length,
            totalItems: response.length,
            totalPages: 1,
          });
        } else if (currentFilters.showOwnedOnly && currentActiveAccount) {
          // Load user's own capes
          const playerCapesOptions: GetPlayerCapesPayloadOptions = {
            player_identifier: currentActiveAccount.id,
          };
          response = await getPlayerCapes(playerCapesOptions);
          const setCapes = getCapesSetter(currentFilters.showOwnedOnly);
          const setPagination = getPaginationSetter(currentFilters.showOwnedOnly);
          setCapes(response);
          setPagination({
            currentPage: 0,
            pageSize: response.length,
            totalItems: response.length,
            totalPages: 1,
          });
        } else {
          // Browse all capes
          const browseOptions: BrowseCapesOptions = {
            page: pageToFetch,
            page_size: 20,
            sort_by:
              currentFilters.sortBy === "" ? undefined : currentFilters.sortBy,
            time_frame:
              currentFilters.timeFrame === ""
                ? undefined
                : currentFilters.timeFrame,
          };
          response = await browseCapes(browseOptions);

          // Get the correct setters based on current filter
          const setCapes = getCapesSetter(currentFilters.showOwnedOnly);
          const setPagination = getPaginationSetter(currentFilters.showOwnedOnly);

          // Update data with proper state management
          setCapes((prevActualCapes) => {
            const newCapes = append ? [...prevActualCapes, ...response.capes] : response.capes;
            // Check if the data is actually different
            if (prevActualCapes.length === newCapes.length &&
                prevActualCapes.every((cape, index) => cape._id === newCapes[index]._id)) {
              return prevActualCapes; // Return same reference to prevent re-render
            }
            return newCapes;
          });
          setPagination(response.pagination);
        }
      } catch (err: any) {
        console.error("Error fetching capes:", err);
        const errorMessage =
          err?.message || t('capes.failedToLoadCapes');
        toast.error(errorMessage);
        if (!append) {
          const setCapes = getCapesSetter(currentFilters.showOwnedOnly);
          const setPagination = getPaginationSetter(currentFilters.showOwnedOnly);
          setCapes([]);
          setPagination(null);
        }
      } finally {
        isLoadingRef.current = false;
        if (append) {
          if (currentFilters.showOwnedOnly) {
            setIsFetchingMoreMy(false);
          } else {
            setIsFetchingMoreAll(false);
          }
        } else {
          if (currentFilters.showOwnedOnly) {
            setIsLoadingMy(false);
          } else {
            setIsLoadingAll(false);
          }
        }
      }
    },
    [], // Stable callback
  );

  // Handle filter/search changes that require reloading data
  useEffect(() => {
    const handleFilterChange = async () => {
      if (isLoadingRef.current) return;

      // For sort/filter changes, reload the current view
      if (currentPage === 0) {
        const currentData = filters.showOwnedOnly ? myCapes : allCapes;
        if (currentData.length > 0) {
          if (filters.showOwnedOnly) {
            setIsLoadingMy(true);
          } else {
            setIsLoadingAll(true);
          }
          try {
            await fetchCapesData(0, filters, searchQuery, false);
          } catch (error) {
            console.error("Failed to reload data:", error);
          } finally {
            if (filters.showOwnedOnly) {
              setIsLoadingMy(false);
            } else {
              setIsLoadingAll(false);
            }
          }
        }
      }
    };

    handleFilterChange();
  }, [filters.sortBy, filters.timeFrame]); // Only trigger on actual filter changes

  // Pagination useEffect
  useEffect(() => {
    const handlePagination = async () => {
      if (currentPage > 0 && !isLoadingRef.current) {
        if (filters.showOwnedOnly) {
          setIsFetchingMoreMy(true);
        } else {
          setIsFetchingMoreAll(true);
        }
        try {
          await fetchCapesData(currentPage, filters, searchQuery, true);
        } catch (error) {
          console.error("Failed to load more data:", error);
        } finally {
          if (filters.showOwnedOnly) {
            setIsFetchingMoreMy(false);
          } else {
            setIsFetchingMoreAll(false);
          }
        }
      }
    };

    handlePagination();
  }, [currentPage]);

  const loadMoreCapes = useCallback(() => {
    if (hasMoreItems && !isFetchingMore) {
      setCurrentPage((prevPage) => prevPage + 1);
    }
  }, [hasMoreItems, isFetchingMore, paginationInfo, currentPage]);

  const handleSortChange = (value: string) => {
    const newFilters = { ...filters, sortBy: value || undefined };
    const hasMajorFilterChanged = newFilters.sortBy !== filters.sortBy;

    setFilters(newFilters);
    if (hasMajorFilterChanged) {
      setSearchQuery("");
      setCurrentPage(0);
      // Trigger reload with new sort filter
      if (!isLoadingRef.current) {
        if (filters.showOwnedOnly) {
          setIsLoadingMy(true);
          fetchCapesData(0, newFilters, "", false).finally(() => {
            setIsLoadingMy(false);
          });
        } else if (!filters.showFavoritesOnly) {
          setIsLoadingAll(true);
          fetchCapesData(0, newFilters, "", false).finally(() => {
            setIsLoadingAll(false);
          });
        }
      }
    } else if (currentPage !== 0) {
      setCurrentPage(0);
    }
  };

  const handleFilterChange = (value: string) => {
    const newFilters = { ...filters, timeFrame: value || undefined };
    const hasMajorFilterChanged = newFilters.timeFrame !== filters.timeFrame;

    setFilters(newFilters);
    if (hasMajorFilterChanged) {
      setSearchQuery("");
      setCurrentPage(0);
      // Trigger reload with new time frame filter
      if (!isLoadingRef.current) {
        if (filters.showOwnedOnly) {
          setIsLoadingMy(true);
          fetchCapesData(0, newFilters, "", false).finally(() => {
            setIsLoadingMy(false);
          });
        } else if (!filters.showFavoritesOnly) {
          setIsLoadingAll(true);
          fetchCapesData(0, newFilters, "", false).finally(() => {
            setIsLoadingAll(false);
          });
        }
      }
    } else if (currentPage !== 0) {
      setCurrentPage(0);
    }
  };

  const handleSearchChange = (value: string) => {
    const previousValue = searchQuery;
    setSearchQuery(value);

    // If search is being cleared (from non-empty to empty), immediately reload default capes
    if (previousValue.trim() !== "" && value.trim() === "") {
      setCurrentPage(0);
      // Clear search results and trigger reload of default capes
      setAllCapes([]);
      setAllPagination(null);
      // Force a reload by triggering search with empty value
      if (!isLoadingRef.current) {
        setIsLoadingAll(true);
        fetchCapesData(0, filters, "", false).finally(() => {
          setIsLoadingAll(false);
        });
      }
    }
  };

  const handleSearchEnter = (value: string) => {
    // Immediately trigger search when Enter is pressed
    // This bypasses the debouncing for instant search
    if (!isLoadingRef.current) {
      fetchCapesData(0, filters, value, false);
    }
  };


  const refreshCurrentView = () => {
    console.log("[CapeBrowser] Refreshing current view...");
    // Clear current view data and reload
    setCurrentPage(0);

    if (!isLoadingRef.current) {
      if (searchQuery && searchQuery.trim() !== "") {
        // When searching, clear search results and reload
        setAllCapes([]);
        setAllPagination(null);
        setIsLoadingAll(true);
        fetchCapesData(0, filters, searchQuery, false).finally(() => {
          setIsLoadingAll(false);
        });
      } else if (filters.showOwnedOnly) {
        setMyCapes([]);
        setMyPagination(null);
        setIsLoadingMy(true);
        fetchCapesData(0, filters, "", false).finally(() => {
          setIsLoadingMy(false);
        });
      } else if (!filters.showFavoritesOnly) {
        setAllCapes([]);
        setAllPagination(null);
        setIsLoadingAll(true);
        fetchCapesData(0, filters, "", false).finally(() => {
          setIsLoadingAll(false);
        });
      }
      // Favorites don't need clearing as they're computed from existing data
    }
  };

  const handleEquipCape = async (capeHash: string) => {
    setIsEquippingCapeId(capeHash);

    let promise;
    if (filters.showVanillaOnly) {
      // For vanilla capes, use the vanilla store
      // Special handling for "no-cape" option - unequip all capes
      const actualCapeId = capeHash === "no-cape" ? null : capeHash;
      promise = useVanillaCapeStore.getState().equipCape(actualCapeId);
    } else {
      // For NoRisk capes, use the regular equip function
      promise = equipCape(capeHash);
    }

    toast.promise(promise, {
      loading: t('capes.equippingCape'),
      success: () => {
        setIsEquippingCapeId(null);
        return t('capes.capeEquippedSuccess');
      },
      error: (err: any) => {
        setIsEquippingCapeId(null);
        console.error("Error equipping cape:", err);
        return t('capes.failedToEquipCape', { error: err.message || t('common.unknownError') });
      },
    });
  };

  const handleUnequipCape = async () => {
    setIsUnequipping(true);
    try {
      await unequipCape();
      toast.success(t('capes.capeUnequippedSuccess'));
    } catch (err: any) {
      console.error("Error unequipping cape:", err);
      toast.error(t('capes.failedToUnequipCape', { error: err.message || t('common.unknownError') }));
    } finally {
      setIsUnequipping(false);
    }
  };

  const handleDeleteCapeClick = (cape: CosmeticCape) => {
    showModal('delete-cape-modal', (
      <ConfirmDeletionModal
        capeToDelete={cape}
        onConfirmDelete={async () => {
          try {
            await deleteCape(cape._id);
            toast.success(t('capes.capeDeletedSuccess'));
            refreshCurrentView();
            hideModal('delete-cape-modal');
          } catch (err: any) {
            console.error("Error deleting cape:", err);
            toast.error(t('capes.failedToDeleteCape', { error: err.message || t('common.unknownError') }));
          }
        }}
        onCancelDelete={() => hideModal('delete-cape-modal')}
      />
    ));
  };

  const handleUploadClick = async () => {
    try {
      const selectedFile = await open({
        multiple: false,
        directory: false,
        filters: [{ name: t('capes.pngImages'), extensions: ["png"] }],
      });
      if (!selectedFile) return;
      const filePath = selectedFile as string;
      setPreviewImagePath(filePath);
      try {
        const imageUrl = convertFileSrc(filePath);
        setPreviewImageUrl(imageUrl);
        setShowPreviewModal(true);

        // Show modal using global modal system
        showModal('upload-cape-modal', (
          <UploadCapeModal
            previewImageUrl={imageUrl}
            previewImagePath={filePath}
            formatErrorMessage={formatErrorMessage}
            isWarningMessage={isWarningMessage}
            onCancelUpload={handleCancelUpload}
          />
        ));
      } catch (err: any) {
        console.error("Error creating preview URL:", err);
        toast.error(t('capes.couldntPreviewFile', { error: err.message || t('common.unknownError') }));
      }
    } catch (err: any) {
      console.error("Error selecting cape file:", err);
      toast.error(
        t('capes.failedToSelectCapeFile', { error: err.message || t('common.unknownError') }),
      );
    }
  };

  const handleCancelUpload = () => {
    hideModal('upload-cape-modal');
    setPreviewImagePath(null);
    setPreviewImageUrl(null);
    setShowPreviewModal(false);
    setShowElytraPreview(false);
    setUploadError(null);
    setUploadWarning(null);
    setIsUploading(false);
  };


  const handleDownloadTemplate = async () => {
    const promise = downloadTemplateAndOpenExplorer();
    toast.promise(promise, {
      loading: t('capes.downloadingTemplate'),
      success: t('capes.templateDownloadedSuccess'),
      error: (err: any) =>
        t('capes.failedToDownloadTemplate', { error: err.message || t('common.unknownError') }),
    });
  };

  const capesForList = useMemo(() => {
    return capesData; // Return the same reference if data hasn't changed
  }, [capesData]);

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 relative">
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {/* Group Tabs */}
        <div className="mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => {
                    const newFilters = { ...filters, showOwnedOnly: false, showFavoritesOnly: false, showVanillaOnly: false };
                    setFilters(newFilters);
                    setSearchQuery("");
                    setCurrentPage(0);
                    if (!isLoadingRef.current) {
                      setIsLoadingAll(true);
                      fetchCapesData(0, newFilters, "", false).finally(() => {
                        setIsLoadingAll(false);
                      });
                    }
                  }}
                  className={`px-3 py-1 rounded-lg font-minecraft text-2xl transition-all duration-200 flex items-center gap-2 border-2 ${
                    !filters.showOwnedOnly && !filters.showFavoritesOnly && !filters.showVanillaOnly
                      ? 'text-white'
                      : 'text-white/70 bg-black/30 hover:bg-black/40 border-white/10 hover:border-white/20'
                  }`}
                  style={{
                    backgroundColor: (!filters.showOwnedOnly && !filters.showFavoritesOnly && !filters.showVanillaOnly) ? `${accentColor.value}20` : undefined,
                    borderColor: (!filters.showOwnedOnly && !filters.showFavoritesOnly && !filters.showVanillaOnly) ? accentColor.value : undefined,
                  }}
                >
                  <span className="lowercase">{t('capes.all')}</span>
                </button>

                <button
                  onClick={() => {
                    if (!activeAccount) return;
                    const newFilters = { ...filters, showOwnedOnly: true, showFavoritesOnly: false, showVanillaOnly: false };
                    setFilters(newFilters);
                    setSearchQuery("");
                    setCurrentPage(0);
                    if (!isLoadingRef.current && activeAccount) {
                      setIsLoadingMy(true);
                      fetchCapesData(0, newFilters, "", false).finally(() => {
                        setIsLoadingMy(false);
                      });
                    }
                  }}
                  disabled={!activeAccount}
                  className={`px-3 py-1 rounded-lg font-minecraft text-2xl transition-all duration-200 flex items-center gap-2 border-2 ${
                    filters.showOwnedOnly && !filters.showFavoritesOnly && !filters.showVanillaOnly
                      ? 'text-white'
                      : 'text-white/70 bg-black/30 hover:bg-black/40 border-white/10 hover:border-white/20'
                  } ${!activeAccount ? 'opacity-50 cursor-not-allowed' : ''}`}
                  style={{
                    backgroundColor: (filters.showOwnedOnly && !filters.showFavoritesOnly && !filters.showVanillaOnly) ? `${accentColor.value}20` : undefined,
                    borderColor: (filters.showOwnedOnly && !filters.showFavoritesOnly && !filters.showVanillaOnly) ? accentColor.value : undefined,
                  }}
                  title={!activeAccount ? t('capes.noActiveAccount') : undefined}
                >
                  <span className="lowercase">{t('capes.myCapes')}</span>
                </button>

                <button
                  onClick={() => {
                    const newFilters = { ...filters, showOwnedOnly: false, showFavoritesOnly: true, showVanillaOnly: false };
                    setFilters(newFilters);
                    setSearchQuery("");
                    setCurrentPage(0);
                  }}
                  className={`px-3 py-1 rounded-lg font-minecraft text-2xl transition-all duration-200 flex items-center gap-2 border-2 ${
                    filters.showFavoritesOnly && !filters.showVanillaOnly
                      ? 'text-white'
                      : 'text-white/70 bg-black/30 hover:bg-black/40 border-white/10 hover:border-white/20'
                  }`}
                  style={{
                    backgroundColor: (filters.showFavoritesOnly && !filters.showVanillaOnly) ? `${accentColor.value}20` : undefined,
                    borderColor: (filters.showFavoritesOnly && !filters.showVanillaOnly) ? accentColor.value : undefined,
                  }}
                >
                  <span className="lowercase">{t('capes.favorites')}</span>
                </button>

                <button
                  onClick={() => {
                    if (!activeAccount) return;
                    const newFilters = { ...filters, showOwnedOnly: false, showFavoritesOnly: false, showVanillaOnly: true };
                    setFilters(newFilters);
                    setSearchQuery("");
                    setCurrentPage(0);
                  }}
                  disabled={!activeAccount}
                  className={`px-3 py-1 rounded-lg font-minecraft text-2xl transition-all duration-200 flex items-center gap-2 border-2 ${
                    filters.showVanillaOnly
                      ? 'text-white'
                      : 'text-white/70 bg-black/30 hover:bg-black/40 border-white/10 hover:border-white/20'
                  } ${!activeAccount ? 'opacity-50 cursor-not-allowed' : ''}`}
                  style={{
                    backgroundColor: filters.showVanillaOnly ? `${accentColor.value}20` : undefined,
                    borderColor: filters.showVanillaOnly ? accentColor.value : undefined,
                  }}
                  title={!activeAccount ? t('capes.noActiveAccount') : undefined}
                >
                  <span className="lowercase">{t('capes.vanilla')}</span>
                </button>
              </div>
            </div>
            {/* Search & Filters */}
            <div className="mb-6 pb-4 border-b border-white/10">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  {!filters.showVanillaOnly ? (
                    <SearchWithFilters
                      placeholder={t('capes.searchPlayerPlaceholder')}
                      searchValue={searchQuery}
                      onSearchChange={handleSearchChange}
                      onSearchEnter={handleSearchEnter}
                      sortOptions={sortOptions}
                      sortValue={filters.sortBy || ""}
                      onSortChange={handleSortChange}
                      filterOptions={filterOptions}
                      filterValue={filters.timeFrame || ""}
                      onFilterChange={handleFilterChange}
                    />
                  ) : (
                    <SearchWithFilters
                      placeholder={t('capes.searchVanillaCapePlaceholder')}
                      searchValue={searchQuery}
                      onSearchChange={handleSearchChange}
                      onSearchEnter={handleSearchEnter}
                      sortOptions={[]} // No sorting options for vanilla capes
                      sortValue=""
                      onSortChange={() => {}} // No-op
                      filterOptions={[]} // No time frame filters for vanilla capes
                      filterValue=""
                      onFilterChange={() => {}} // No-op
                    />
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-3">
                  {activeAccount && (
                    <>
                      <button
                        onClick={handleDownloadTemplate}
                        className="flex items-center gap-2 px-4 py-2 bg-black/30 hover:bg-black/40 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded-lg font-minecraft text-2xl lowercase transition-all duration-200"
                        title={t('capes.downloadTemplate')}
                      >
                        <div className="w-4 h-4 flex items-center justify-center">
                          <Icon icon="solar:download-bold" className="w-4 h-4" />
                        </div>
                        <span>{t('capes.template')}</span>
                      </button>

                      <button
                        onClick={handleUploadClick}
                        className="flex items-center gap-2 px-4 py-2 bg-black/30 hover:bg-black/40 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded-lg font-minecraft text-2xl lowercase transition-all duration-200"
                        title={t('capes.uploadCape')}
                      >
                        <div className="w-4 h-4 flex items-center justify-center">
                          <Icon icon="solar:upload-bold" className="w-4 h-4" />
                        </div>
                        <span>{t('capes.upload')}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Cape List */}
            <CapeList
              capes={capesForList}
              onEquipCape={handleEquipCape}
              isLoading={isLoading}
              isEquippingCapeId={isEquippingCapeId}
              equippedCapeId={equippedCapeId}
              searchQuery={searchQuery}
              canDelete={(filters.showOwnedOnly && !!activeAccount) && !(searchQuery && searchQuery.trim() !== "") && !filters.showVanillaOnly}
              onDeleteCape={handleDeleteCapeClick}
              loadMoreItems={loadMoreCapes}
              hasMoreItems={hasMoreItems}
              isFetchingMore={isFetchingMore}
              onTriggerUpload={activeAccount ? handleUploadClick : undefined}
              onDownloadTemplate={activeAccount ? handleDownloadTemplate : undefined}
              groupFavoritesInHeader={filters.showFavoritesOnly}
              showFavoritesOnly={filters.showFavoritesOnly}
              isVanilla={filters.showVanillaOnly}
            />
      </div>
    </div>
  );
}
