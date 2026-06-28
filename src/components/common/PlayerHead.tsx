import React, { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { usePlayerAvatar } from "../../hooks/usePlayerAvatar";

interface PlayerHeadProps {
  uuid: string | null | undefined;
  username?: string | null;
  size?: number;
  overlay?: boolean;
  fill?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function PlayerHead({
  uuid,
  username,
  size = 64,
  overlay = true,
  fill = false,
  className,
  style,
}: PlayerHeadProps) {
  const avatarUrl = usePlayerAvatar({ uuid, size, overlay });
  const [hasError, setHasError] = useState(false);

  useEffect(() => setHasError(false), [avatarUrl]);

  const sizeStyle: React.CSSProperties = fill
    ? { width: "100%", height: "100%" }
    : { width: size, height: size };

  if (avatarUrl && !hasError) {
    return (
      <img
        src={avatarUrl}
        alt={username ? `${username}'s head` : "Player head"}
        draggable={false}
        className={cn("object-cover select-none", className)}
        style={{ imageRendering: "pixelated", ...sizeStyle, ...style }}
        onError={() => setHasError(true)}
      />
    );
  }

  return (
    <span
      className={cn(
        "flex items-center justify-center text-white font-minecraft lowercase",
        className,
      )}
      style={{ ...sizeStyle, ...style }}
    >
      {username?.charAt(0)?.toUpperCase() || "?"}
    </span>
  );
}
