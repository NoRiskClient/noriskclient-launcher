"use client";

import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MinecraftProfile, TexturesData } from "../../types/minecraft";
import type {
  GetStarlightSkinRenderPayload,
  MinecraftSkin,
  SkinVariant,
} from "../../types/localSkin";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { MinecraftSkinService } from "../../services/minecraft-skin-service";
import { Button } from "../ui/buttons/Button";
import { IconButton } from "../ui/buttons/IconButton";
import { Icon } from "@iconify/react";
import { StatusMessage } from "../ui/StatusMessage";
import { SkinViewer } from "../launcher/SkinViewer";
import { useDebounce } from "../../hooks/useDebounce";
import { useThemeStore } from "../../store/useThemeStore";
import { useSkinStore } from "../../store/useSkinStore";
import { useSkinFavoritesStore } from "../../store/useSkinFavoritesStore";
import { useSkinFoldersStore } from "../../store/useSkinFoldersStore";
import { toast } from "react-hot-toast";
import { convertFileSrc } from "@tauri-apps/api/core";
import { SearchWithFilters } from "../ui/SearchWithFilters";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { AddSkinModal } from "../modals/AddSkinModal";
import { CreateFolderModal } from "../modals/CreateFolderModal";
import { MoveToFolderModal } from "../modals/MoveToFolderModal";
import { FolderCard } from "../skins/FolderCard";
import { cn } from "../../lib/utils";

const SkinPreview = memo(
  ({
    skin,
    index,
    loading,
    localSkinsLoading,
    selectedLocalSkin,
    isApplied,
    onClick,
    onEditSkin,
    onDeleteSkin,
    onMoveToFolder,
    onDragStart,
    draggable,
    hideMoveButton,
  }: {
    skin: MinecraftSkin;
    index: number;
    loading: boolean;
    localSkinsLoading: boolean;
    selectedLocalSkin: MinecraftSkin | null;
    isApplied?: boolean;
    onClick: (skin: MinecraftSkin) => void;
    onEditSkin?: (
      skin: MinecraftSkin,
      event: React.MouseEvent<HTMLButtonElement>,
    ) => void;
    onDeleteSkin?: (
      skinId: string,
      skinName: string,
      event: React.MouseEvent<HTMLButtonElement>,
    ) => void;
    onMoveToFolder?: (skin: MinecraftSkin) => void;
    onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
    draggable?: boolean;
    hideMoveButton?: boolean;
  }) => {
    const [isHovered, setIsHovered] = useState(false);
    const accentColor = useThemeStore((state) => state.accentColor);
    const isBackgroundAnimationEnabled = useThemeStore(
      (state) => state.isBackgroundAnimationEnabled,
    );
    const { isFavorite, toggleFavorite } = useSkinFavoritesStore();
    const isSelected = selectedLocalSkin?.id === skin.id;
    const isDisabled = loading && isSelected;
    const isSkinFavorite = isFavorite(skin.id);

    const [starlightRenderUrl, setStarlightRenderUrl] = useState<string | null>(
      null,
    );
    const [isRenderLoading, setIsRenderLoading] = useState<boolean>(true);
    const [canShowSpinner, setCanShowSpinner] = useState<boolean>(false);
    const spinnerTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
      let isMounted = true;
      setIsRenderLoading(true);
      setStarlightRenderUrl(null);
      setCanShowSpinner(false);

      if (spinnerTimeoutRef.current) {
        clearTimeout(spinnerTimeoutRef.current);
      }

      spinnerTimeoutRef.current = setTimeout(() => {
        if (isMounted && isRenderLoading) {
          setCanShowSpinner(true);
        }
      }, 500);

      const fetchRender = async () => {
        if (skin && skin.name) {
          try {
            const payload: GetStarlightSkinRenderPayload = {
              player_name: "skin",
              render_type: "default",
              render_view: "full",
              base64_skin_data: skin.base64_data,
            };
            const localPath =
              await MinecraftSkinService.getStarlightSkinRender(payload);
            if (isMounted) {
              if (localPath) {
                setStarlightRenderUrl(convertFileSrc(localPath));
              } else {
                console.warn(
                  `[SkinPreview] Starlight render returned empty path for ${skin.name}.`,
                );
                setStarlightRenderUrl("");
              }
              setIsRenderLoading(false);
              setCanShowSpinner(false);
              if (spinnerTimeoutRef.current)
                clearTimeout(spinnerTimeoutRef.current);
            }
          } catch (error) {
            console.error(
              `[SkinPreview] Failed to fetch Starlight skin render for ${skin.name}:`,
              error,
            );
            if (isMounted) {
              setStarlightRenderUrl("");
              setIsRenderLoading(false);
              setCanShowSpinner(false);
              if (spinnerTimeoutRef.current)
                clearTimeout(spinnerTimeoutRef.current);
            }
          }
        } else {
          if (isMounted) {
            console.warn(
              `[SkinPreview] No skin.name provided, cannot fetch Starlight render.`,
            );
            setStarlightRenderUrl("");
            setIsRenderLoading(false);
            setCanShowSpinner(false);
            if (spinnerTimeoutRef.current)
              clearTimeout(spinnerTimeoutRef.current);
          }
        }
      };

      fetchRender();

      return () => {
        isMounted = false;
        if (spinnerTimeoutRef.current) {
          clearTimeout(spinnerTimeoutRef.current);
        }
      };
    }, [skin?.name, skin?.base64_data, skin]);

    const animationStyle = isBackgroundAnimationEnabled
      ? { animationDelay: `${index * 0.075}s` }
      : {};
    const animationClasses = isBackgroundAnimationEnabled
      ? "animate-in fade-in duration-500 fill-mode-both"
      : "";

    return (
      <div
        key={skin.id}
        style={{
          ...animationStyle,
          backgroundColor: isHovered ? `${accentColor.value}20` : undefined,
          borderColor: isHovered ? `${accentColor.value}60` : undefined,
        }}
        className={cn(
          "relative flex flex-col gap-3 p-4 rounded-lg bg-black/20 border border-white/10 hover:border-white/20 transition-all duration-200 cursor-pointer",
          animationClasses,
          isDisabled ? "opacity-60 pointer-events-none" : ""
        )}
        onClick={(e) => {
          // Don't trigger click if we just finished dragging
          if (e.defaultPrevented) return;
          !isDisabled && !isApplied && !isSelected && onClick(skin);
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onDragStart={onDragStart}
        draggable={draggable}
      >
        {/* Action buttons - top right */}
        <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
          {/* Favorite button */}
          <button
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleFavorite(skin.id);
            }}
            className="w-8 h-8 flex items-center justify-center bg-black/30 hover:bg-black/50 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded transition-all duration-200"
            title={isSkinFavorite ? "Unfavorite" : "Favorite"}
            disabled={isDisabled}
          >
            <Icon
              icon={isSkinFavorite ? "ph:heart-fill" : "ph:heart"}
              className="w-4 h-4"
              style={{ color: isSkinFavorite ? "#ef4444" : undefined }}
            />
          </button>

          {onEditSkin && (
            <button
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onEditSkin(skin, event);
              }}
              className="w-8 h-8 flex items-center justify-center bg-black/30 hover:bg-black/50 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded transition-all duration-200"
              title="Edit skin properties"
              disabled={isDisabled}
            >
              <Icon icon="solar:pen-bold" className="w-4 h-4" />
            </button>
          )}

          {onMoveToFolder && !hideMoveButton && (
            <button
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onMoveToFolder(skin);
              }}
              className="w-8 h-8 flex items-center justify-center bg-black/30 hover:bg-black/50 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded transition-all duration-200"
              title="Move to folder"
              disabled={isDisabled}
            >
              <Icon icon="solar:folder-bold" className="w-4 h-4" />
            </button>
          )}

          {onDeleteSkin && (
            <button
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDeleteSkin(skin.id, skin.name, event);
              }}
              className="w-8 h-8 flex items-center justify-center bg-black/30 hover:bg-red-700/80 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded transition-all duration-200"
              title="Delete skin"
              disabled={isDisabled}
            >
              <Icon
                icon="solar:trash-bin-trash-bold"
                className="w-4 h-4"
              />
            </button>
          )}
        </div>

        {/* Skin content */}
        <div className="flex flex-col items-center gap-3 relative z-10 w-full">
          {/* Skin Image */}
          <div
            className="relative flex-shrink-0 rounded-lg flex items-center justify-center overflow-hidden border border-transparent transition-all duration-300 ease-out"
            style={{
              width: "140px",
              height: "280px",
            }}
          >
            {isRenderLoading && canShowSpinner ? (
              <div className="flex flex-col items-center justify-center space-y-2">
                <div className="w-8 h-8 border-4 border-t-transparent border-[var(--accent)] rounded-full animate-spin"></div>
                <p className="font-minecraft text-xs text-white/70 lowercase">Loading...</p>
              </div>
            ) : !isRenderLoading ? (
              <SkinViewer
                skinUrl={starlightRenderUrl || ""}
                width={140}
                height={280}
                className="rounded-sm block"
              />
            ) : null}

            {/* Applying overlay */}
            {isDisabled && (
              <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center rounded-lg">
                <Icon
                  icon="solar:refresh-bold"
                  className="w-8 h-8 animate-spin mb-1"
                  style={{ color: accentColor.value }}
                />
                <span className="font-minecraft text-xs text-white lowercase">
                  Applying
                </span>
              </div>
            )}
          </div>

          {/* Skin Info */}
          <div className="flex-grow min-w-0 w-full text-center">
            {/* Skin Name */}
            <h3
              className="font-minecraft-ten text-white text-base whitespace-nowrap overflow-hidden text-ellipsis max-w-full normal-case mb-1"
              title={skin.name}
            >
              {skin.name}
            </h3>

            {/* Skin Variant & Applied Status */}
            <div className="flex items-center justify-center gap-2 text-xs font-minecraft-ten">
              <div className="text-white/60 flex items-center gap-1">
                <Icon
                  icon="solar:palette-bold"
                  className="w-3 h-3 text-white/50"
                />
                <span>{skin.variant === "slim" ? "Slim" : "Classic"}</span>
              </div>

              {isApplied && (
                <>
                  <div className="w-px h-3 bg-white/30"></div>
                  <div className="text-green-400 flex items-center gap-1">
                    <Icon
                      icon="solar:check-circle-bold"
                      className="w-3 h-3"
                    />
                    <span>Applied</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

const AddSkinCard = memo(
  ({ index, onClick }: { index: number; onClick: () => void }) => {
    const [isHovered, setIsHovered] = useState(false);
    const isBackgroundAnimationEnabled = useThemeStore(
      (state) => state.isBackgroundAnimationEnabled,
    );
    const accentColor = useThemeStore((state) => state.accentColor);

    const animationStyle = isBackgroundAnimationEnabled
      ? { animationDelay: `${index * 0.075}s` }
      : {};
    const animationClasses = isBackgroundAnimationEnabled
      ? "animate-in fade-in duration-500 fill-mode-both"
      : "";

    return (
      <div
        key={`add-skin-${index}`}
        style={animationStyle}
        className={cn(
          "relative flex flex-col gap-3 p-4 rounded-lg bg-black/20 border border-dashed border-white/10 hover:border-white/30 transition-all duration-200 cursor-pointer",
          animationClasses
        )}
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Skin content */}
        <div className="flex flex-col items-center gap-3 relative z-10 w-full">
          {/* Skin Image */}
          <div
            className="relative flex-shrink-0 rounded-lg flex items-center justify-center overflow-hidden border border-transparent transition-all duration-300 ease-out"
            style={{
              width: "140px",
              height: "280px",
            }}
          >
            <SkinViewer
              skinUrl="/skins/default_skin_full.png"
              width={140}
              height={280}
              className="rounded-sm block opacity-70 hover:opacity-100 transition-opacity"
            />

            {/* Plus icon overlay */}
            <div className="absolute inset-0 flex items-center justify-center">
              <Icon
                icon="solar:add-circle-bold"
                className="w-12 h-12 text-white/70 hover:text-white transition-colors"
                style={{ color: isHovered ? accentColor.value : undefined }}
              />
            </div>
          </div>

          {/* Skin Info */}
          <div className="flex-grow min-w-0 w-full text-center">
            {/* Skin Name */}
            <h3
              className="font-minecraft-ten text-white text-base whitespace-nowrap overflow-hidden text-ellipsis max-w-full normal-case mb-1"
              title="Add New Skin"
            >
              Add New Skin
            </h3>

            {/* Description */}
            <div className="flex items-center justify-center gap-2 text-xs font-minecraft-ten">
              <div className="text-white/60 flex items-center gap-1">
                <Icon
                  icon="solar:upload-bold"
                  className="w-3 h-3 text-white/50"
                />
                <span>Upload or import</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);


export function SkinsTab() {
  const {
    activeAccount,
    isLoading: accountLoading,
    error: accountError,
    initializeAccounts,
  } = useMinecraftAuthStore();
  const { showModal, hideModal } = useGlobalModal();
  const { selectedSkinId, setSelectedSkinId } = useSkinStore();
  const { favoriteSkinIds, isFavorite } = useSkinFavoritesStore();
  const { folders, addFolder, deleteFolder, addSkinToFolder, removeSkinFromFolder } = useSkinFoldersStore();

  const showMoveToFolderModal = (skin: MinecraftSkin) => {
    showModal('move-to-folder-modal', (
      <MoveToFolderModal
        isOpen={true}
        skin={skin}
        folders={folders}
        onClose={() => hideModal('move-to-folder-modal')}
        onMoveToFolder={(folderId) => {
          folders.forEach(folder => {
            if (folder.id !== folderId && folder.skin_ids.includes(skin.id)) {
              removeSkinFromFolder(folder.id, skin.id);
            }
          });

          addSkinToFolder(folderId, skin.id);
          
          const folderName = folders.find(f => f.id === folderId)?.name;
          toast.success(`📁 Skin moved to folder "${folderName}"`);
          hideModal('move-to-folder-modal');

          setCurrentFolder(folderId);
          setSearch("");
          setShowFavoritesOnly(false);
        }}
      />
    ));
  };
  const [skinData, setSkinData] = useState<MinecraftProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [localSkins, setLocalSkins] = useState<MinecraftSkin[]>([]);
  const [localSkinsLoading, setLocalSkinsLoading] = useState<boolean>(false);
  const [localSkinsError, setLocalSkinsError] = useState<string | null>(null);
  const [selectedLocalSkin, setSelectedLocalSkin] =
    useState<MinecraftSkin | null>(null);
  const [search, setSearch] = useState<string>("");
  const [currentSkinId, setCurrentSkinId] = useState<string | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState<boolean>(false);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);

  const debouncedSearch = useDebounce(search, 250);
  const accentColor = useThemeStore((state) => state.accentColor);

  const filteredSkins = useMemo(() => {
    let filtered = localSkins;

    if (debouncedSearch.trim()) {
      filtered = filtered.filter((skin) =>
        skin.name.toLowerCase().includes(debouncedSearch.toLowerCase()),
      );
    }

    if (showFavoritesOnly) {
      filtered = filtered.filter((skin) => isFavorite(skin.id));
    }

    if (!showFavoritesOnly) {
      if (currentFolder) {
        const folder = folders.find(f => f.id === currentFolder);
        if (folder) {
          filtered = filtered.filter((skin) => folder.skin_ids.includes(skin.id));
        }
      } else {
        filtered = filtered.filter((skin) => {
          return !folders.some(folder => folder.skin_ids.includes(skin.id));
        });
      }
    }

    return filtered;
  }, [localSkins, debouncedSearch, showFavoritesOnly, isFavorite, favoriteSkinIds, currentFolder, folders]);

  const loadSkinData = useCallback(async () => {
    if (!activeAccount) return;

    setLoading(true);

    try {
      const data = await MinecraftSkinService.getUserSkinData(
        activeAccount.id,
        activeAccount.access_token,
      );
      setSkinData(data);

      if (data?.properties) {
        const texturesProp = data.properties.find(
          (prop: { name: string; value: string }) => prop.name === "textures",
        );

        if (texturesProp) {
          try {
            const decodedValue = atob(texturesProp.value);
            const texturesJson = JSON.parse(decodedValue) as TexturesData;
            const skinInfo = texturesJson.textures?.SKIN;

            if (skinInfo?.url) {
              const urlParts = skinInfo.url.split("/");
              const skinIdFromUrl = urlParts[urlParts.length - 1].split(".")[0];
              setCurrentSkinId(skinIdFromUrl);
            }
          } catch (e) {
            console.error("Error parsing skin textures:", e);
            toast.error("Failed to parse skin details.");
          }
        }
      }
    } catch (err) {
      console.error("Error loading skin data:", err);
      toast.error(err instanceof Error ? err.message : String(err.message));
    } finally {
      setLoading(false);
    }
  }, [activeAccount]);

  const loadLocalSkins = useCallback(async () => {
    setLocalSkinsLoading(true);
    setLocalSkinsError(null);

    try {
      const skins = await MinecraftSkinService.getAllSkins();

      setLocalSkins(skins);
      console.log(`Loaded ${skins.length} local skins`);

      if (selectedSkinId) {
        const selectedSkin = skins.find((skin) => skin.id === selectedSkinId);
        if (selectedSkin) {
          setSelectedLocalSkin(selectedSkin);
        }
      }
      setLocalSkinsLoading(false);
    } catch (err) {
      console.error("Error loading local skins:", err);
      setLocalSkinsError(err instanceof Error ? err.message : String(err));
      setLocalSkinsLoading(false);
    }
  }, [selectedSkinId]);

  useEffect(() => {
    if (activeAccount) {
      loadSkinData();
    }

    loadLocalSkins();

    if (!activeAccount && !accountLoading) {
      initializeAccounts();
    }
  }, [
    activeAccount,
    loadSkinData,
    loadLocalSkins,
    initializeAccounts,
    accountLoading,
  ]);

  const startEditSkin = (
    skin: MinecraftSkin | null,
    event?: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event?.stopPropagation();
    showModal('add-skin-modal', (
      <AddSkinModal
        skin={skin}
        onSave={async (newSkin) => {
          await saveSkin(newSkin);
          if (currentFolder && newSkin.id) {
            addSkinToFolder(currentFolder, newSkin.id);
            toast.success(`📁 Skin added to folder "${folders.find(f => f.id === currentFolder)?.name}"`);
          }
        }}
        onAdd={addSkin}
        isLoading={localSkinsLoading}
      />
    ));
  };

  const saveSkin = async (skin: MinecraftSkin) => {
    if (!skin) return;

    try {
      const updatedSkin = await MinecraftSkinService.updateSkinProperties(
        skin.id,
        skin.name,
        skin.variant,
      );

      if (updatedSkin) {
        setLocalSkins((prevSkins) =>
          prevSkins.map((s) => (s.id === updatedSkin.id ? updatedSkin : s)),
        );
        if (selectedLocalSkin?.id === updatedSkin.id) {
          setSelectedLocalSkin(updatedSkin);
        }
        hideModal('add-skin-modal');
      } else {
        toast.error("Skin not found. It may have been deleted.");
      }
    } catch (err) {
      console.error("Error updating skin properties:", err);
      toast.error(err instanceof Error ? err.message : String(err.message));
    }
  };

  const addSkin = async (
    skinInput: string,
    targetName: string,
    targetVariant: SkinVariant,
    description?: string | null,
  ) => {
    try {
      const newSkin = await MinecraftSkinService.addSkinLocally(
        skinInput,
        targetName,
        targetVariant,
        description,
      );
      setLocalSkins((prevSkins) =>
        [...prevSkins, newSkin].sort((a, b) => a.name.localeCompare(b.name)),
      );
      hideModal('add-skin-modal');
    } catch (err) {
      console.error("Error adding new skin:", err);
      const errorMessage =
        err instanceof Error ? err.message : String(err.message);
      toast.error(`Failed to add skin: ${errorMessage}`);
    }
  };

  const handleDeleteSkin = async (skinId: string, skinName: string) => {
    const deletePromise = async () => {
      const removed = await MinecraftSkinService.removeSkin(skinId);
      if (!removed) {
        throw new Error(
          `Skin "${skinName}" could not be found or was already deleted.`,
        );
      }
      return removed;
    };

    toast.promise(
      deletePromise(),
      {
        loading: `Deleting skin "${skinName}"...`,
        success: () => {
          setLocalSkins((prevSkins) =>
            prevSkins.filter((s) => s.id !== skinId),
          );
          if (selectedLocalSkin?.id === skinId) {
            setSelectedLocalSkin(null);
            setSelectedSkinId(null);
          }
          return `Successfully deleted skin: ${skinName}`;
        },
        error: (err) => {
          console.error("Error deleting skin:", err);
          return err instanceof Error ? err.message : String(err.message);
        },
      },
      {
        success: { duration: 4000 },
        error: { duration: 5000 },
      },
    );
  };

  const applyLocalSkin = async (skin: MinecraftSkin) => {
    if (!activeAccount) {
      toast.error("You must be logged in to apply a skin");
      return;
    }

    if (isSkinApplied(skin)) {
      toast.error(`Skin "${skin.name}" is already applied to your account`);
      return;
    }

    setLoading(true);
    setSelectedLocalSkin(skin);

    try {
      await MinecraftSkinService.applySkinFromBase64(
        activeAccount.id,
        activeAccount.access_token,
        skin.base64_data,
        skin.variant,
      );

      toast.success(
        `Successfully applied skin: ${skin.name} (${skin.variant} model)`,
      );
      await loadSkinData();
    } catch (err) {
      console.error("Error applying local skin:", err);
      toast.error(err instanceof Error ? err.message : String(err.message));
    } finally {
      setLoading(false);
    }
  };

  const isSkinApplied = (skin: MinecraftSkin): boolean => {
    if (!currentSkinId) return false;
    return skin.id === currentSkinId;
  };

  // Add skin button
  const addSkinButton = (
    <button
      onClick={() => startEditSkin(null)}
      className="flex items-center gap-2 px-4 py-2 bg-black/30 hover:bg-black/40 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded-lg font-minecraft text-2xl lowercase transition-all duration-200"
      title="Add Skin"
      disabled={!activeAccount}
    >
      <div className="w-4 h-4 flex items-center justify-center">
        <Icon icon="solar:add-circle-bold" className="w-4 h-4" />
      </div>
      <span>add skin</span>
    </button>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 relative">
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {/* Search & Filters */}
        <div className="mb-6 pb-4 border-b border-white/10">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <SearchWithFilters
                placeholder="Search skins..."
                searchValue={search}
                onSearchChange={setSearch}
                onSearchEnter={() => {}} // Optional: implement instant search
              />
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              {/* Create Folder Button */}
              <button
                onClick={() => {
                  showModal('create-folder-modal', (
                    <CreateFolderModal
                      isOpen={true}
                      onClose={() => hideModal('create-folder-modal')}
                      onCreateFolder={(folderName) => {
                        addFolder(folderName);
                        toast.success(`📁 Folder "${folderName}" created successfully!`);
                        hideModal('create-folder-modal');
                      }}
                    />
                  ));
                }}
                className="px-3 py-1 rounded-lg font-minecraft text-2xl transition-all duration-200 flex items-center gap-2 border-2 text-white/70 bg-black/30 hover:bg-black/40 border-white/10 hover:border-white/20"
                title="Create New Folder"
              >
                <Icon icon="solar:folder-plus-bold" className="w-4 h-4" />
                <span className="lowercase">New Folder</span>
              </button>

              {/* Filter Tabs */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowFavoritesOnly(false)}
                  className={`px-3 py-1 rounded-lg font-minecraft text-2xl transition-all duration-200 flex items-center gap-2 border-2 ${
                    !showFavoritesOnly
                      ? 'text-white'
                      : 'text-white/70 bg-black/30 hover:bg-black/40 border-white/10 hover:border-white/20'
                  }`}
                  style={{
                    backgroundColor: !showFavoritesOnly ? `${accentColor.value}20` : undefined,
                    borderColor: !showFavoritesOnly ? accentColor.value : undefined,
                  }}
                >
                  <span className="lowercase">all</span>
                </button>

                <button
                  onClick={() => setShowFavoritesOnly(true)}
                  className={`px-3 py-1 rounded-lg font-minecraft text-2xl transition-all duration-200 flex items-center gap-2 border-2 ${
                    showFavoritesOnly
                      ? 'text-white'
                      : 'text-white/70 bg-black/30 hover:bg-black/40 border-white/10 hover:border-white/20'
                  }`}
                  style={{
                    backgroundColor: showFavoritesOnly ? `${accentColor.value}20` : undefined,
                    borderColor: showFavoritesOnly ? accentColor.value : undefined,
                  }}
                >
                  <Icon 
                    icon="ph:heart-fill" 
                    className="w-5 h-5"
                    style={{ color: "#ef4444" }}
                  />
                  <span className="lowercase">favorites</span>
                </button>
              </div>

              {activeAccount && addSkinButton}
            </div>
          </div>
        </div>

        {/* Breadcrumb Navigation */}
        {currentFolder && (
          <div className="mb-4 pb-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setCurrentFolder(null);
                  setSearch("");
                  setShowFavoritesOnly(false);
                }}
                className="flex items-center gap-2 text-white/70 hover:text-white transition-colors font-minecraft-ten text-sm"
              >
                <Icon icon="solar:arrow-left-bold" className="w-4 h-4" />
                <span>Back to All Skins</span>
              </button>
              
              <div className="w-px h-4 bg-white/30"></div>
              
              <div className="flex items-center gap-2 text-white font-minecraft-ten text-sm">
                <Icon icon="solar:folder-bold" className="w-4 h-4 text-blue-400" />
                <span>{folders.find(f => f.id === currentFolder)?.name}</span>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="space-y-8">
        {accountLoading ? (
          <p className="text-white/70 font-minecraft text-xl text-center py-4">
            Loading account...
          </p>
        ) : accountError ? (
          <StatusMessage
            type="error"
            className="font-minecraft text-lg"
            message={`Account Error: ${accountError}`}
          />
        ) : !activeAccount ? (
          <p className="text-white/70 italic font-minecraft text-xl text-center py-10">
            Please log in to a Minecraft account to manage skins.
          </p>
        ) : (
          <>
            <div className="space-y-5 text-center">
              {localSkinsLoading ? (
                <p className="text-white/70 font-minecraft text-xl text-center py-4">
                  Loading skins...
                </p>
              ) : localSkinsError ? (
                <StatusMessage
                  type="error"
                  className="font-minecraft text-lg"
                  message={localSkinsError}
                />
              ) : !localSkinsLoading &&
                localSkins.length > 0 &&
                filteredSkins.length === 0 &&
                !localSkinsError ? (
                <p className="text-white/70 italic font-minecraft text-lg">
                  No skins match your search. Try a different search term.
                </p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                  {/* Add Skin Card - only show when not in a folder */}
                  {!currentFolder && (
                    <AddSkinCard
                      index={0}
                      onClick={() => startEditSkin(null, undefined)}
                    />
                  )}
                  
                  {/* Folders - only show when not in a folder and not showing favorites */}
                  {!currentFolder && !showFavoritesOnly && folders.map((folder, index) => (
                    <FolderCard
                      key={folder.id}
                      folder={folder}
                      onClick={() => {
                        setCurrentFolder(folder.id);
                        setSearch("");
                        setShowFavoritesOnly(false);
                      }}
                      onDelete={(folderId, folderName) => {
                        deleteFolder(folderId);
                        toast.success(`📁 Folder "${folderName}" deleted`);
                      }}
                      onDrop={(folderId, skinId) => {
                        addSkinToFolder(folderId, skinId);
                        const folderName = folders.find(f => f.id === folderId)?.name;
                        toast.success(`📁 Skin moved to folder "${folderName}"`);
                      }}
                    />
                  ))}
                  
                  {/* Skins */}
                  {filteredSkins.map((skin, index) => (
                    <SkinPreview
                      key={skin.id}
                      skin={skin}
                      index={index + (currentFolder ? 1 : folders.length + 1)}
                      loading={loading}
                      localSkinsLoading={localSkinsLoading}
                      selectedLocalSkin={selectedLocalSkin}
                      isApplied={isSkinApplied(skin)}
                      onClick={applyLocalSkin}
                      onEditSkin={startEditSkin}
                      onDeleteSkin={handleDeleteSkin}
                      onMoveToFolder={!currentFolder ? showMoveToFolderModal : undefined}
                      hideMoveButton={currentFolder !== null}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", skin.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.dropEffect = "move";
                      }}
                      draggable={true} // Always draggable
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        </div>

      </div>
    </div>
  );
}
