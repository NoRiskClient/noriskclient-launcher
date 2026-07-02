"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { getMcRealPostImage } from "../../services/mcreal-service";
import type { McRealImageType } from "../../types/mcreal";

interface LoadedImage {
  url: string;
  blurred: boolean;
}

/**
 * BeReal-style dual image: big primary with a tappable thumbnail of the
 * other slot in the corner. Tapping the thumbnail swaps the two.
 */
export function McRealImage({ postId }: { postId: string }) {
  const { t } = useTranslation();
  const [images, setImages] = useState<Record<McRealImageType, LoadedImage | null>>({
    primary: null,
    secondary: null,
  });
  const [front, setFront] = useState<McRealImageType>("primary");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setImages({ primary: null, secondary: null });
    setFront("primary");
    setFailed(false);

    (async () => {
      try {
        const primary = await getMcRealPostImage(postId, "primary");
        if (cancelled) return;
        setImages((prev) => ({ ...prev, primary }));
        const secondary = await getMcRealPostImage(postId, "secondary");
        if (cancelled) return;
        setImages((prev) => ({ ...prev, secondary }));
      } catch (e) {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [postId]);

  const big = images[front];
  const smallType: McRealImageType = front === "primary" ? "secondary" : "primary";
  const small = images[smallType];
  const locked = big?.blurred ?? false;

  return (
    <div className="relative w-full aspect-[16/10] bg-black/40 overflow-hidden rounded-md">
      {failed ? (
        <div className="w-full h-full flex items-center justify-center text-white/40">
          <Icon icon="solar:gallery-broken" className="w-10 h-10" />
        </div>
      ) : big ? (
        <img
          src={big.url}
          alt=""
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full animate-pulse bg-white/5" />
      )}

      {small && !locked && (
        <button
          onClick={() => setFront(smallType)}
          className="absolute top-2 left-2 w-1/4 aspect-[16/10] rounded-md overflow-hidden border-2 border-black/70 shadow-lg cursor-pointer p-0 bg-transparent"
          aria-label="swap image"
        >
          <img
            src={small.url}
            alt=""
            className="w-full h-full object-cover"
            draggable={false}
          />
        </button>
      )}

      {locked && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/30 backdrop-blur-[2px]">
          <Icon icon="solar:lock-keyhole-bold" className="w-8 h-8 text-white/80" />
          <span className="font-minecraft-ten text-xs text-white/80 text-center px-4">
            {t("mcreal.locked")}
          </span>
        </div>
      )}
    </div>
  );
}
