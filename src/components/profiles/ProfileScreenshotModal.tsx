"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "../ui/Modal";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { ScreenshotInfo as ActualScreenshotInfo } from "../../types/profile";
import { IconButton } from "../ui/buttons/IconButton";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { Image as TauriImage } from "@tauri-apps/api/image";
import { revealItemInDir } from "../../utils/opener-utils";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";

interface ProfileScreenshotModalProps {
  isOpen: boolean;
  onClose: () => void;
  screenshot: ActualScreenshotInfo | null;
  onScreenshotDeleted: (deletedPath: string) => void;
}

export function ProfileScreenshotModal({
  isOpen,
  onClose,
  screenshot,
  onScreenshotDeleted,
}: ProfileScreenshotModalProps) {
  const { t } = useTranslation();
  const [isModalImageLoaded, setIsModalImageLoaded] = useState(false);
  const [isCopyingImage, setIsCopyingImage] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    // Reset image loaded state when the screenshot changes or modal opens/closes
    if (isOpen && screenshot) {
      setIsModalImageLoaded(false);
    }
  }, [isOpen, screenshot]);

  if (!isOpen || !screenshot) {
    return null;
  }

  const handleCopyImage = async () => {
    if (!screenshot?.path || isCopyingImage) return;

    setIsCopyingImage(true);

    const copyPromise = writeImage(screenshot.path);

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
    if (!screenshot?.path || isDeleting) return;

    // const confirmed = window.confirm(
    //   `Are you sure you want to permanently delete the screenshot "${screenshot.filename}"?`
    // );
    // if (!confirmed) return;

    setIsDeleting(true);

    const deletePromise = invoke("delete_file", { filePath: screenshot.path });

    toast.promise(
      deletePromise,
      {
        loading: t('screenshots.deleting', { name: screenshot.filename }),
        success: () => {
          onScreenshotDeleted(screenshot.path);
          onClose();
          setIsDeleting(false);
          return t('screenshots.deleted', { name: screenshot.filename });
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
    if (!screenshot?.path) return;
    try {
      await revealItemInDir(screenshot.path);
      // No explicit success toast needed as the OS will show the folder
    } catch (error) {
      console.error("Failed to reveal item in folder:", error);
      toast.error(t('profiles.errors.open_folder_failed'));
    }
  };

  return (
    <Modal
      title={screenshot.filename}
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
        <img
          src={convertFileSrc(screenshot.path)}
          alt={`Enlarged screenshot: ${screenshot.filename}`}
          className={cn(
            "block max-w-full max-h-full w-auto h-auto object-contain rounded-md transition-opacity duration-700 ease-in-out",
            isModalImageLoaded ? "opacity-100" : "opacity-0"
          )}
          style={{ maxHeight: 'calc(85vh - 150px)' }}
          onLoad={() => setIsModalImageLoaded(true)}
          onError={() => {
            setIsModalImageLoaded(false);
            console.error("Failed to load image in modal for:", screenshot?.path);
            // Future: Could show a placeholder error within the modal image area
          }}
        />

        {/* Action Buttons - Visual Only */}
        {isModalImageLoaded && ( // Show buttons only when image is loaded
          <div className="absolute bottom-4 right-4 flex gap-2 z-10">
            <IconButton
              icon={isCopyingImage ? <Icon icon="eos-icons:loading" /> : <Icon icon="solar:copy-bold-duotone" />}
              title={t('screenshots.copy_image')}
              onClick={handleCopyImage}
              disabled={isCopyingImage}
              variant="flat"
              size="sm"
              className="rounded-md w-9 h-9 flex items-center justify-center"
            />
            <IconButton
              icon={<Icon icon="solar:folder-with-files-bold-duotone" />}
              title={t('screenshots.open_location')}
              onClick={handleOpenFolder}
              variant="flat"
              size="sm"
              className="rounded-md w-9 h-9 flex items-center justify-center"
            />
            <IconButton
              icon={isDeleting ? <Icon icon="eos-icons:loading" /> : <Icon icon="solar:trash-bin-trash-bold-duotone" />}
              title={t('screenshots.delete_screenshot')}
              onClick={handleDeleteScreenshot}
              disabled={isDeleting}
              variant="destructive"
              size="sm"
              className="w-9 h-9 flex items-center justify-center"
            />
          </div>
        )}
      </div>
    </Modal>
  );
} 