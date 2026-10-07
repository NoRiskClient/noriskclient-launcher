"use client";

import type React from "react";
import { forwardRef } from "react";
import { cn } from "../../lib/utils";

interface NewsCardProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
  imageUrl: string;
  postUrl: string;
}

export const NewsCard = forwardRef<HTMLButtonElement, NewsCardProps>(
  (
    {
      className,
      title,
      imageUrl,
      postUrl,
      onClick,
      disabled = false,
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || !onClick || !postUrl || postUrl === "#";
    return (
      <button
        {...props}
        ref={ref}
        type="button"
        aria-label={title || postUrl}
        title={title || postUrl}
        disabled={isDisabled}
        className={cn("relative w-full h-full appearance-none bg-transparent p-0 overflow-hidden rounded-lg border-2 border-white/10 enabled:hover:border-white/20 focus-visible:border-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80 transition-all duration-200", isDisabled ? "cursor-default" : "cursor-pointer", className)}
        onClick={(event) => { if (!isDisabled) onClick?.(event); }}
      >
        <img
          src={imageUrl || "/placeholder.svg"}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.src = "/placeholder.svg";
          }}
        />
      </button>
    );
  },
);

NewsCard.displayName = "NewsCard";
