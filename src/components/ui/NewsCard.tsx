"use client";

import type React from "react";
import { forwardRef } from "react";
import { cn } from "../../lib/utils";
import { useTranslation } from "react-i18next";

interface NewsCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  imageUrl: string;
  postUrl: string;
}

export const NewsCard = forwardRef<HTMLDivElement, NewsCardProps>(
  (
    {
      className,
      title,
      imageUrl,
      postUrl,
      onClick,
      ...props
    },
    ref,
  ) => {
    const { t } = useTranslation();
    return (
      <div
        ref={ref}
        className={cn("relative w-full h-full overflow-hidden rounded-lg border-2 border-white/10 hover:border-white/20 transition-all duration-200", className)}
        onClick={onClick}
        {...props}
      >
        <img
          src={imageUrl || "/placeholder.svg"}
          alt={title || t("news.image_alt")}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.src = "/placeholder.svg";
          }}
        />
      </div>
    );
  },
);

NewsCard.displayName = "NewsCard";
