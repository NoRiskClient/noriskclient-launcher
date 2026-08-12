"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "../ui/Modal";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { copyFile, mkdir, exists, BaseDirectory } from '@tauri-apps/plugin-fs';
import { join, appDataDir } from '@tauri-apps/api/path';
import type { ScreenshotInfo as ActualScreenshotInfo, ScreenshotGroup } from "../../types/profile";
import { IconButton } from "../ui/buttons/IconButton";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { Image as TauriImage } from "@tauri-apps/api/image";
import { revealItemInDir } from "../../utils/opener-utils";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "../../store/useThemeStore";
import { useBackgroundEffectStore } from "../../store/background-effect-store";

interface ProfileScreenshotModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: ScreenshotGroup | null;
  onScreenshotDeleted: (deletedPath: string) => void;
  onNext?: () => void;
  onPrev?: () => void;
}

export function ProfileScreenshotModal({
  isOpen,
  onClose,
  group,
  onScreenshotDeleted,
  onNext,
  onPrev,
}: ProfileScreenshotModalProps) {
  const { t } = useTranslation();
  const setCustomMedia = useBackgroundEffectStore((s) => s.setCustomMedia);
  const [isModalImageLoaded, setIsModalImageLoaded] = useState(false);
  const [isCopyingImage, setIsCopyingImage] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showBackgroundConfirm, setShowBackgroundConfirm] = useState(false);
  
  // BeReal Swap State
  const [swapped, setSwapped] = useState(false);

  // Reset states on change
  useEffect(() => {
    if (isOpen && group) {
      setIsModalImageLoaded(false);
      setSwapped(false);
      setShowBackgroundConfirm(false);
    }
    if (!isOpen) {
      setShowBackgroundConfirm(false);
    }
  }, [isOpen, group?.main.path]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" && onNext) {
        onNext();
      } else if (e.key === "ArrowLeft" && onPrev) {
        onPrev();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onNext, onPrev]);

  if (!isOpen || !group) {
    return null;
  }

  const currentMainInfo = swapped && group.secondary ? group.secondary : group.main;
  const currentSecInfo = swapped ? group.main : group.secondary;
  const currentIsVideo = currentMainInfo.path.toLowerCase().match(/\.(mp4|webm|mov)$/);

  const handleCopyImage = async () => {
    if (!currentMainInfo?.path || isCopyingImage || currentIsVideo) {
      if (currentIsVideo) toast.error("Copying videos is not supported.");
      return;
    }

    setIsCopyingImage(true);

    const copyPromise = writeImage(currentMainInfo.path);

    toast.promise(
      copyPromise,
      {
        loading: t('screenshots.copying'),
        success: () => {
          setIsCopyingImage(false);
          return t('screenshots.copy_success');
        },
        error: (err) => {
          setIsCopyingImage(false);
          console.error("Failed to copy screenshot image:", err);
          return t('screenshots.copy_failed', { error: err.toString() });
        },
      }
    );
  };

  const handleDeleteScreenshot = async () => {
    if (!currentMainInfo?.path || isDeleting) return;

    setIsDeleting(true);

    const deletePromise = invoke("delete_file", { filePath: currentMainInfo.path });

    toast.promise(
      deletePromise,
      {
        loading: t('screenshots.deleting', { name: currentMainInfo.filename }),
        success: () => {
          onScreenshotDeleted(currentMainInfo.path);
          if (group.secondary) onScreenshotDeleted(group.secondary.path); // Delete both for bereal for simplicity
          onClose();
          setIsDeleting(false);
          return t('screenshots.deleted', { name: currentMainInfo.filename });
        },
        error: (err) => {
          setIsDeleting(false);
          console.error("Failed to delete screenshot:", err);
          return t('screenshots.delete_failed', { error: err.toString() });
        },
      }
    );
  };

  const handleOpenFolder = async () => {
    if (!currentMainInfo?.path) return;
    try {
      await revealItemInDir(currentMainInfo.path);
      // No explicit success toast needed as the OS will show the folder
    } catch (error) {
      console.error("Failed to reveal item in folder:", error);
      toast.error(t('profiles.errors.open_folder_failed'));
    }
  };

  const handleSetBackgroundClick = () => {
    const currentMedia = useBackgroundEffectStore.getState().customMediaUrl;
    if (currentMedia) {
      setShowBackgroundConfirm(true);
    } else {
      performSetBackground();
    }
  };

  const performSetBackground = async () => {
    if (!currentMainInfo?.path) return;
    try {
      // 1. Create a "backgrounds" directory in the AppData directory if it doesn't exist
      const hasBgDir = await exists('backgrounds', { baseDir: BaseDirectory.AppData });
      if (!hasBgDir) {
        await mkdir('backgrounds', { baseDir: BaseDirectory.AppData, recursive: true });
      }

      // 2. Generate a unique filename and determine paths
      const ext = currentMainInfo.path.split('.').pop() || (currentIsVideo ? 'mp4' : 'png');
      const filename = `custom_bg_${Date.now()}.${ext}`;
      
      // 3. Copy the file
      await copyFile(currentMainInfo.path, `backgrounds/${filename}`, { toPathBaseDir: BaseDirectory.AppData });

      // 4. Resolve the full destination path
      const baseAppData = await appDataDir();
      const finalPath = await join(baseAppData, "backgrounds", filename);

      setCustomMedia(finalPath, currentIsVideo ? 'video' : 'image');
      toast.success(t('settings.custom_background.set_success') || "Custom background set!");
      setShowBackgroundConfirm(false);
    } catch (e) {
      console.error("Failed to copy background image permanently:", e);
      // Fallback
      setCustomMedia(currentMainInfo.path, currentIsVideo ? 'video' : 'image');
      toast.success(t('settings.custom_background.set_success') || "Custom background set!");
      setShowBackgroundConfirm(false);
    }
  };

  return (
    <Modal
      title={currentMainInfo.filename}
      titleIcon={<Icon icon="solar:gallery-bold-duotone" className="w-6 h-6" />}
      onClose={onClose}
      width="xl"
      closeOnClickOutside
    >
      <div className="flex justify-center items-center py-4 bg-transparent min-h-[400px] max-h-[calc(85vh-120px)] relative">
        {!isModalImageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon icon="eos-icons:loading" className="w-12 h-12 text-white/70" />
          </div>
        )}
        
        {currentIsVideo ? (
          <video
            src={convertFileSrc(currentMainInfo.path)}
            controls
            autoPlay
            controlsList="nofullscreen"
            onDoubleClick={(e) => e.preventDefault()}
            className={cn(
              "block max-w-full max-h-full w-auto h-auto object-contain rounded-md transition-opacity duration-700 ease-in-out",
              isModalImageLoaded ? "opacity-100" : "opacity-0"
            )}
            style={{ maxHeight: 'calc(85vh - 150px)' }}
            onLoadedData={() => setIsModalImageLoaded(true)}
          />
        ) : (
          <img
            src={convertFileSrc(currentMainInfo.path)}
            alt={`Enlarged screenshot: ${currentMainInfo.filename}`}
            className={cn(
              "block max-w-full max-h-full w-auto h-auto object-contain rounded-md transition-opacity duration-700 ease-in-out",
              isModalImageLoaded ? "opacity-100" : "opacity-0"
            )}
            style={{ maxHeight: 'calc(85vh - 150px)' }}
            onLoad={() => setIsModalImageLoaded(true)}
            onError={() => {
              setIsModalImageLoaded(false);
              console.error("Failed to load image in modal for:", currentMainInfo?.path);
            }}
          />
        )}

        {/* BeReal Secondary Swap Overlay */}
        {isModalImageLoaded && group.type === 'bereal' && currentSecInfo && (
          <div 
            onClick={(e) => { e.stopPropagation(); setSwapped(!swapped); setIsModalImageLoaded(false); }}
            className="absolute top-4 right-4 w-[22%] max-w-[200px] aspect-video rounded-lg overflow-hidden border-4 border-black/80 shadow-2xl cursor-pointer z-20 hover:scale-105 transition-transform bg-black"
            title="Swap Images"
          >
            {currentSecInfo.path.toLowerCase().match(/\.(mp4|webm|mov)$/) ? (
              <video src={convertFileSrc(currentSecInfo.path)} muted loop autoPlay className="w-full h-full object-cover" />
            ) : (
              <img src={convertFileSrc(currentSecInfo.path)} className="w-full h-full object-cover" alt="" />
            )}
          </div>
        )}

        {/* Navigation Arrows */}
        {isModalImageLoaded && onPrev && (
          <button
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white/70 hover:text-white hover:bg-black/60 transition-colors"
          >
            <Icon icon="solar:alt-arrow-left-linear" className="w-6 h-6" />
          </button>
        )}
        {isModalImageLoaded && onNext && (
          <button
            onClick={(e) => { e.stopPropagation(); onNext(); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/40 text-white/70 hover:text-white hover:bg-black/60 transition-colors"
          >
            <Icon icon="solar:alt-arrow-right-linear" className="w-6 h-6" />
          </button>
        )}

        {/* Action Buttons - Visual Only */}
        {isModalImageLoaded && ( // Show buttons only when image is loaded
          <div className="absolute bottom-4 right-4 flex gap-2 z-10 bg-black/40 p-2 rounded-lg backdrop-blur-sm">
            <IconButton
              icon={<Icon icon="solar:wallpaper-bold-duotone" className="w-5 h-5" />}
              title={t('screenshots.set_background') || "Set as Custom Background"}
              onClick={handleSetBackgroundClick}
              variant="flat"
              size="md"
              className="rounded-md w-10 h-10 flex items-center justify-center"
            />
            <IconButton
              icon={isCopyingImage ? <Icon icon="eos-icons:loading" className="w-5 h-5" /> : <Icon icon="solar:copy-bold-duotone" className="w-5 h-5" />}
              title={t('screenshots.copy_image')}
              onClick={handleCopyImage}
              disabled={isCopyingImage}
              variant="flat"
              size="md"
              className="rounded-md w-10 h-10 flex items-center justify-center"
            />
            <IconButton
              icon={<Icon icon="solar:folder-with-files-bold-duotone" className="w-5 h-5" />}
              title={t('screenshots.open_location')}
              onClick={handleOpenFolder}
              variant="flat"
              size="md"
              className="rounded-md w-10 h-10 flex items-center justify-center"
            />
            <IconButton
              icon={isDeleting ? <Icon icon="eos-icons:loading" className="w-5 h-5" /> : <Icon icon="solar:trash-bin-trash-bold-duotone" className="w-5 h-5" />}
              title={t('screenshots.delete_screenshot')}
              onClick={handleDeleteScreenshot}
              disabled={isDeleting}
              variant="destructive"
              size="md"
              className="rounded-md w-10 h-10 flex items-center justify-center"
            />
          </div>
        )}

        {/* Background Replacement Confirmation */}
        {showBackgroundConfirm && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 rounded-md backdrop-blur-sm">
            <div className="bg-[#1a1b1e] border border-white/10 p-6 rounded-lg max-w-sm text-center shadow-xl">
              <Icon icon="solar:wallpaper-bold-duotone" className="w-12 h-12 mx-auto mb-4" style={{ color: useThemeStore.getState().accentColor.value }} />
              <h3 className="text-lg font-bold text-white mb-2">{t('screenshots.replace_background_title') || "Replace Background?"}</h3>
              <p className="text-white/70 mb-6 text-sm">
                {t('screenshots.replace_background_desc') || "You already have a custom background set. Do you want to replace it with this screenshot?"}
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setShowBackgroundConfirm(false)}
                  className="px-4 py-2 rounded-md bg-white/10 hover:bg-white/20 transition-colors text-white font-medium text-sm"
                >
                  {t('common.cancel') || "Cancel"}
                </button>
                <button
                  onClick={performSetBackground}
                  className="px-4 py-2 rounded-md transition-colors text-white font-medium text-sm"
                  style={{ backgroundColor: useThemeStore.getState().accentColor.value }}
                >
                  {t('common.replace') || "Replace"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
} 