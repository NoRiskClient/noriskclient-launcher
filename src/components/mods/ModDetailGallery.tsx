"use client";

import React, { useState, useRef } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useAnimationsEnabled } from "../../hooks/useEntranceAnimation";
import type { UnifiedGalleryImage } from "../../types/unified";
import { ModDetailLightbox } from "./ModDetailLightbox";

interface ModDetailGalleryProps {
  images: UnifiedGalleryImage[];
}

export function ModDetailGallery({ images }: ModDetailGalleryProps) {
  const { t } = useTranslation();
  const animationsEnabled = useAnimationsEnabled();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -300, behavior: animationsEnabled ? "smooth" : "auto" });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 300, behavior: animationsEnabled ? "smooth" : "auto" });
    }
  };

  // Sort images by ordering, with featured first
  const sortedImages = [...images].sort((a, b) => {
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    return a.ordering - b.ordering;
  });

  return (
    <>
      <div className="relative">
        {/* Section Title */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-minecraft text-white flex items-center gap-2 normal-case">
            <Icon icon="solar:gallery-bold" className="w-5 h-5" />
            {t('mod_detail.gallery_title')}
          </h2>
          <span className="text-xs text-white/50 font-minecraft">
            {t('mod_detail.gallery_count', { count: images.length })}
          </span>
        </div>

        {/* Gallery Container with Navigation */}
        <div className="relative">
          {/* Left Navigation Button */}
          {images.length > 3 && (
            <button
              onClick={scrollLeft}
              type="button"
              aria-label={t('mod_detail.gallery_scroll_previous')}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-black/70 hover:bg-black/90 rounded-full flex items-center justify-center text-white transition-colors"
            >
              <Icon icon="solar:alt-arrow-left-bold" className="w-5 h-5" />
            </button>
          )}

          {/* Right Navigation Button */}
          {images.length > 3 && (
            <button
              onClick={scrollRight}
              type="button"
              aria-label={t('mod_detail.gallery_scroll_next')}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-black/70 hover:bg-black/90 rounded-full flex items-center justify-center text-white transition-colors"
            >
              <Icon icon="solar:alt-arrow-right-bold" className="w-5 h-5" />
            </button>
          )}

          {/* Image Container */}
          <div
            ref={scrollContainerRef}
            className="flex gap-3 overflow-x-auto [&::-webkit-scrollbar]:hidden"
            style={{
              scrollSnapType: "x mandatory",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
            }}
          >
          {sortedImages.map((image, index) => (
            <button
              key={image.url}
              type="button"
              aria-label={t('mod_detail.gallery_open', { index: index + 1, title: image.title || t('mod_detail.gallery_image', { index: index + 1 }) })}
              onClick={() => openLightbox(index)}
              className="relative w-[280px] h-40 flex-shrink-0 rounded-lg overflow-hidden border border-white/10 hover:border-white/30 focus-visible:border-white/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white transition-colors duration-200 group"
              style={{ scrollSnapAlign: "start" }}
            >
              <img
                src={image.thumbnail_url || image.url}
                alt={image.title || t('mod_detail.gallery_image', { index: index + 1 })}
                width={280}
                height={160}
                className="w-full h-full object-cover"
                loading="lazy"
              />

              {/* Hover Overlay */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 group-focus-visible:bg-black/40 transition-colors flex items-center justify-center">
                <Icon
                  icon="solar:magnifer-zoom-in-bold"
                  className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
                />
              </div>

              {/* Featured Badge */}
              {image.featured && (
                <div className="absolute top-2 left-2 bg-yellow-500/90 text-black text-xs font-minecraft px-2 py-0.5 rounded">
                  {t('mod_detail.gallery_featured')}
                </div>
              )}

              {/* Title (if available) */}
              {image.title && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                  <p className="text-xs text-white font-minecraft truncate">
                    {image.title}
                  </p>
                </div>
              )}
            </button>
          ))}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      <ModDetailLightbox
        images={sortedImages}
        initialIndex={lightboxIndex}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </>
  );
}
