"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import type { UnifiedGalleryImage } from "../../types/unified";
import { Modal } from "../ui/Modal";
import { useAnimationsEnabled } from "../../hooks/useEntranceAnimation";

function boundedIndex(index: number, length: number): number {
  return Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : 0, Math.max(0, length - 1)));
}

interface ModDetailLightboxProps {
  images: UnifiedGalleryImage[];
  initialIndex: number;
  isOpen: boolean;
  onClose: () => void;
}

export function ModDetailLightbox({
  images,
  initialIndex,
  isOpen,
  onClose,
}: ModDetailLightboxProps) {
  const { t } = useTranslation();
  const animationsEnabled = useAnimationsEnabled();
  const [currentIndex, setCurrentIndex] = useState(() => boundedIndex(initialIndex, images.length));
  const [isZoomed, setIsZoomed] = useState(false);

  // Reset index when opening
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(boundedIndex(initialIndex, images.length));
      setIsZoomed(false);
    }
  }, [isOpen, initialIndex, images.length]);

  const goToPrevious = useCallback(() => {
    setCurrentIndex((prev) => (boundedIndex(prev, images.length) + images.length - 1) % images.length);
    setIsZoomed(false);
  }, [images.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (boundedIndex(prev, images.length) + 1) % images.length);
    setIsZoomed(false);
  }, [images.length]);

  if (!isOpen || images.length === 0) return null;

  const visibleIndex = boundedIndex(currentIndex, images.length);
  const currentImage = images[visibleIndex];

  return (
    <Modal
      title={t('lightbox.title')}
      onClose={onClose}
      width="full"
      contentClassName="relative"
    >
      {/* Only focused descendants of this dialog navigate images. Escape and
          focus restoration belong to the shared topmost-dialog contract. */}
      <div
        className="relative"
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            event.stopPropagation();
            if (images.length > 1) (event.key === 'ArrowLeft' ? goToPrevious : goToNext)();
          }
        }}
      >
      <div className="relative h-[55vh]" data-lightbox-image-viewport="true">
      {/* Navigation - Previous */}
      {images.length > 1 && (
        <button
          type="button"
          aria-label={t('lightbox.previous')}
          onClick={(e) => {
            e.stopPropagation();
            goToPrevious();
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
        >
          <Icon icon="solar:arrow-left-bold" className="w-6 h-6" />
        </button>
      )}

      {/* Navigation - Next */}
      {images.length > 1 && (
        <button
          type="button"
          aria-label={t('lightbox.next')}
          onClick={(e) => {
            e.stopPropagation();
            goToNext();
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
        >
          <Icon icon="solar:arrow-right-bold" className="w-6 h-6" />
        </button>
      )}

      {/* Image Container */}
      <button
        type="button"
        aria-label={t(isZoomed ? 'lightbox.zoom_out' : 'lightbox.zoom_in')}
        aria-pressed={isZoomed}
        className="relative block mx-auto w-[80vw] max-w-full h-full overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
        onClick={() => setIsZoomed((prev) => !prev)}
      >
        <img
          src={currentImage.url}
          alt={currentImage.title || t('mod_detail.gallery_image', { index: visibleIndex + 1 })}
          className={`
            w-full h-full object-contain
            ${animationsEnabled ? "transition-transform duration-300" : ""} cursor-pointer
            ${isZoomed ? "scale-150" : "scale-100"}
          `}
        />
      </button>
      </div>

      {/* Bottom Info Bar */}
      <div className="bg-gradient-to-t from-black/80 to-transparent p-6 [overflow-wrap:anywhere]">
        <div className="max-w-4xl mx-auto">
          {/* Counter */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-white/70 font-minecraft text-sm">
              {t('lightbox.counter', { current: visibleIndex + 1, total: images.length })}
            </span>
            <div className="flex flex-wrap items-center gap-2 text-white/50 text-xs font-minecraft">
              <span>{t('lightbox.zoom_hint')}</span>
              <span>|</span>
              <span>{t('lightbox.arrow_keys_navigate')}</span>
              <span>|</span>
              <span>{t('lightbox.esc_close')}</span>
            </div>
          </div>

          {/* Title & Description */}
          {(currentImage.title || currentImage.description) && (
            <div className="mt-2">
              {currentImage.title && (
                <h3 className="text-lg font-minecraft text-white">
                  {currentImage.title}
                </h3>
              )}
              {currentImage.description && (
                <p className="text-sm text-white/70 font-minecraft mt-1">
                  {currentImage.description}
                </p>
              )}
            </div>
          )}

          {/* Thumbnail Navigation */}
          {images.length > 1 && (
            <div className="flex w-fit max-w-full mx-auto gap-2 mt-4 overflow-x-auto pb-2">
              {images.map((image, index) => (
                <button
                  key={image.url}
                  type="button"
                  aria-label={t('lightbox.show_image', { index: index + 1 })}
                  aria-pressed={index === visibleIndex}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentIndex(index);
                    setIsZoomed(false);
                  }}
                  className={`
                    flex-shrink-0 w-16 h-12 rounded overflow-hidden border-2 transition-all
                    ${index === visibleIndex ? "border-white" : "border-transparent opacity-50 hover:opacity-100"}
                  `}
                >
                  <img
                    src={image.thumbnail_url || image.url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </Modal>
  );
}
