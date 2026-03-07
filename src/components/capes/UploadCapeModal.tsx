"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { SkinView3DWrapper } from "../common/SkinView3DWrapper";
import { Button } from "../ui/buttons/Button";
import { IconButton } from "../ui/buttons/IconButton";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";
import { uploadCape } from "../../services/cape-service";
import { toast } from "react-hot-toast";

const padCapeToPreviewSize = (imageUrl: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (img.naturalWidth === 512 && img.naturalHeight === 256) {
        resolve(imageUrl);
        return;
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Could not get canvas context')); return; }
      canvas.width = 512;
      canvas.height = 256;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageUrl;
  });
};

interface UploadCapeModalProps {
  previewImageUrl: string;
  previewImagePath: string;
  formatErrorMessage: (error: string) => string;
  isWarningMessage: (error: string) => boolean;
  onCancelUpload: () => void;
}

export function UploadCapeModal({
  previewImageUrl,
  previewImagePath,
  formatErrorMessage,
  isWarningMessage,
  onCancelUpload
}: UploadCapeModalProps) {
  const { t } = useTranslation();
  const [paddedPreviewUrl, setPaddedPreviewUrl] = useState<string | null>(null);
  const [isCapeOnly, setIsCapeOnly] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setIsCapeOnly(img.naturalWidth !== 512 || img.naturalHeight !== 256);
    img.src = previewImageUrl;
    padCapeToPreviewSize(previewImageUrl)
      .then(setPaddedPreviewUrl)
      .catch(() => setPaddedPreviewUrl(previewImageUrl));
  }, [previewImageUrl]);
  const accentColor = useThemeStore((state) => state.accentColor);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showElytraPreview, setShowElytraPreview] = useState(false);

  const handleConfirmUpload = async () => {
    setIsUploading(true);
    setUploadError(null);
    setUploadWarning(null);

    try {
      const result = await uploadCape(previewImagePath);

      toast.success(t('capes.capeUploadedSuccess'));

      onCancelUpload(); // Close modal on success
    } catch (err: any) {
      console.error("Error uploading cape:", err);
      const formattedError = formatErrorMessage(err.message || "Unknown error");

      if (isWarningMessage(formattedError)) {
        setUploadWarning(formattedError);
        setUploadError(null);
      } else {
        setUploadError(formattedError);
        setUploadWarning(null);
      }
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Modal
      title={t('capes.previewAndUploadCape')}
      onClose={onCancelUpload}
      closeOnClickOutside={true}
      width="md"
      variant="flat"
    >
      <div className="p-4">
        <p className="text-white/80 mb-4 text-center font-minecraft-ten">
          {uploadError ? t('capes.failedToUploadCape') : uploadWarning ? t('capes.capeSubmittedForReview') : t('capes.doesThisLookCorrect')}
        </p>
        {uploadError && (
          <div className="mb-4 p-3 bg-red-900/20 border border-red-500/50 rounded-md">
            <p className="text-red-400 text-sm font-minecraft-ten text-center">
              {uploadError}
            </p>
          </div>
        )}
        {uploadWarning && (
          <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-500/50 rounded-md">
            <p className="text-yellow-400 text-sm font-minecraft-ten text-center">
              {uploadWarning}
            </p>
            <p className="text-yellow-300/70 text-xs font-minecraft-ten text-center mt-2">
              {t('capes.reviewsCanTake24Hours')}
            </p>
          </div>
        )}
        <div className="relative flex justify-center items-center mb-6 p-2 rounded-md aspect-[10/16] max-w-[200px] mx-auto">
          <SkinView3DWrapper
            capeUrl={paddedPreviewUrl || previewImageUrl}
            className="w-full h-full"
            zoom={1.5}
            displayAsElytra={showElytraPreview}
          />
          {!isCapeOnly && (
            <IconButton
              onClick={() => setShowElytraPreview(!showElytraPreview)}
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 z-10"
              icon={
                <Icon
                  icon={
                    showElytraPreview
                      ? "ph:airplane-tilt-fill"
                      : "ph:airplane-tilt-duotone"
                  }
                  className="w-5 h-5"
                />
              }
              title={showElytraPreview ? t('capes.showAsCape') : t('capes.showAsElytra')}
            />
          )}
        </div>
        <div className="flex justify-center gap-4">
          <Button
            onClick={handleConfirmUpload}
            variant="flat"
            disabled={isUploading || !!uploadError || !!uploadWarning}
            size="lg"
          >
            {isUploading ? t('capes.uploading') : t('capes.uploadCape')}
          </Button>
          <Button
            onClick={onCancelUpload}
            variant="flat-secondary"
            disabled={isUploading}
            size="lg"
          >
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
