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

// Temporary fix: replace raw ban-expiry timestamps with a human-readable form.
// Backend messages can embed a Unix-ms timestamp (13 digits), Unix-s timestamp (10 digits),
// or an ISO 8601 string — all become e.g. "until Jul 15, 2026, 12:34 PM (2h 30m left)".
function formatBanTimestamp(message: string): string {
  const TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})|\b\d{13,14}\b|\b1\d{9}\b/g;

  return message.replace(TIMESTAMP, (match) => {
    let date: Date;
    if (/^\d{13,14}$/.test(match))   date = new Date(Number(match));
    else if (/^\d{10}$/.test(match)) date = new Date(Number(match) * 1000);
    else                             date = new Date(match);

    if (isNaN(date.getTime())) return match;

    const now = Date.now();
    const diff = date.getTime() - now;

    // Reject numbers that resolve to more than 1 year in the past (not a ban timestamp).
    if (diff < -365 * 86_400_000) return match;

    if (diff > 100 * 365 * 86_400_000) return 'permanently';

    const dateStr = date.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    if (diff <= 0) return `until ${dateStr} (expired)`;

    const days    = Math.floor(diff / 86_400_000);
    const hours   = Math.floor((diff % 86_400_000) / 3_600_000);
    const minutes = Math.floor((diff % 3_600_000)  / 60_000);

    const timeLeft = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    return `until ${dateStr} (${timeLeft} left)`;
  });
}

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
  formatErrorMessage: (error: unknown) => string;
  isWarningMessage: (error: unknown) => boolean;
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
      const formattedError = formatBanTimestamp(formatErrorMessage(err));

      if (isWarningMessage(err)) {
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
