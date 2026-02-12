"use client";

import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { toast } from "react-hot-toast";
import { convertFileSrc } from "@tauri-apps/api/core";
import { SearchWithFilters } from "../ui/SearchWithFilters";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { AddSkinModal } from "../modals/AddSkinModal";
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
  }) => {
    const [isHovered, setIsHovered] = useState(false);
    const accentColor = useThemeStore((state) => state.accentColor);
    const isBackgroundAnimationEnabled = useThemeStore(
      (state) => state.isBackgroundAnimationEnabled,
    );
    const { t } = useTranslation();
    const isSelected = selectedLocalSkin?.id === skin.id;
    const isDisabled = loading && isSelected;

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
        onClick={() =>
          !isDisabled && !isApplied && !isSelected && onClick(skin)
        }
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Action buttons - top right */}
        <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
          {onEditSkin && (
            <button
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onEditSkin(skin, event);
              }}
              className="w-8 h-8 flex items-center justify-center bg-black/30 hover:bg-black/50 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded transition-all duration-200"
              title={t('skins.editProperties')}
              disabled={isDisabled}
            >
              <Icon icon="solar:pen-bold" className="w-4 h-4" />
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
              title={t('skins.deleteSkin')}
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
                <p className="font-minecraft text-xs text-white/70 lowercase">{t('skins.loading')}</p>
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
                  {t('skins.applying')}
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
                <span>{skin.variant === "slim" ? t('skins.slim') : t('skins.classic')}</span>
              </div>

              {isApplied && (
                <>
                  <div className="w-px h-3 bg-white/30"></div>
                  <div className="text-green-400 flex items-center gap-1">
                    <Icon
                      icon="solar:check-circle-bold"
                      className="w-3 h-3"
                    />
                    <span>{t('skins.applied')}</span>
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
    const { t } = useTranslation();
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
              title={t('skins.addNewSkin')}
            >
              {t('skins.addNewSkin')}
            </h3>

            {/* Description */}
            <div className="flex items-center justify-center gap-2 text-xs font-minecraft-ten">
              <div className="text-white/60 flex items-center gap-1">
                <Icon
                  icon="solar:upload-bold"
                  className="w-3 h-3 text-white/50"
                />
                <span>{t('skins.uploadOrImport')}</span>
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
  const { t } = useTranslation();
  const { selectedSkinId, setSelectedSkinId } = useSkinStore();
  const [skinData, setSkinData] = useState<MinecraftProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [localSkins, setLocalSkins] = useState<MinecraftSkin[]>([]);
  const [localSkinsLoading, setLocalSkinsLoading] = useState<boolean>(false);
  const [localSkinsError, setLocalSkinsError] = useState<string | null>(null);
  const [selectedLocalSkin, setSelectedLocalSkin] =
    useState<MinecraftSkin | null>(null);
  const [search, setSearch] = useState<string>("");
  const [currentSkinId, setCurrentSkinId] = useState<string | null>(null);

  const debouncedSearch = useDebounce(search, 250);
  const accentColor = useThemeStore((state) => state.accentColor);

  const filteredSkins = useMemo(() => {
    if (!debouncedSearch.trim()) return localSkins;
    return localSkins.filter((skin) =>
      skin.name.toLowerCase().includes(debouncedSearch.toLowerCase()),
    );
  }, [localSkins, debouncedSearch]);

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
            toast.error(t('skins.failedToParseSkinDetails'));
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
        onSave={saveSkin}
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
        toast.error(t('skins.skinNotFound'));
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
      toast.error(t('skins.failedToAddSkin', { error: errorMessage }));
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
        loading: t('skins.deletingSkin', { name: skinName }),
        success: () => {
          setLocalSkins((prevSkins) =>
            prevSkins.filter((s) => s.id !== skinId),
          );
          if (selectedLocalSkin?.id === skinId) {
            setSelectedLocalSkin(null);
            setSelectedSkinId(null);
          }
          return t('skins.deletedSkinSuccess', { name: skinName });
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
      toast.error(t('skins.mustBeLoggedIn'));
      return;
    }

    if (isSkinApplied(skin)) {
      toast.error(t('skins.skinAlreadyApplied', { name: skin.name }));
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
        t('skins.appliedSkinSuccess', { name: skin.name, variant: skin.variant }),
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
      title={t('skins.addSkin')}
      disabled={!activeAccount}
    >
      <div className="w-4 h-4 flex items-center justify-center">
        <Icon icon="solar:add-circle-bold" className="w-4 h-4" />
      </div>
      <span>{t('skins.addSkin')}</span>
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
                placeholder={t('skins.searchPlaceholder')}
                searchValue={search}
                onSearchChange={setSearch}
                onSearchEnter={() => {}} // Optional: implement instant search
              />
            </div>

            {/* Action Button */}
            <div className="flex items-center gap-3">
              {activeAccount && addSkinButton}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-8">
        {accountLoading ? (
          <p className="text-white/70 font-minecraft text-xl text-center py-4">
            {t('skins.loadingAccount')}
          </p>
        ) : accountError ? (
          <StatusMessage
            type="error"
            className="font-minecraft text-lg"
            message={t('skins.accountError', { error: accountError })}
          />
        ) : !activeAccount ? (
          <p className="text-white/70 italic font-minecraft text-xl text-center py-10">
            {t('skins.pleaseLogIn')}
          </p>
        ) : (
          <>
            <div className="space-y-5 text-center">
              {localSkinsLoading ? (
                <p className="text-white/70 font-minecraft text-xl text-center py-4">
                  {t('skins.loadingSkins')}
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
                  {t('skins.noSkinsMatchSearch')}
                </p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                  <AddSkinCard
                    index={0}
                    onClick={() => startEditSkin(null, undefined)}
                  />
                  {filteredSkins.map((skin, index) => (
                    <SkinPreview
                      key={skin.id}
                      skin={skin}
                      index={index + 1}
                      loading={loading}
                      localSkinsLoading={localSkinsLoading}
                      selectedLocalSkin={selectedLocalSkin}
                      isApplied={isSkinApplied(skin)}
                      onClick={applyLocalSkin}
                      onEditSkin={startEditSkin}
                      onDeleteSkin={handleDeleteSkin}
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
