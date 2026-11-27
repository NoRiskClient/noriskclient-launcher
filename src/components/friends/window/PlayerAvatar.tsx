import { memo } from "react";
import { useInView } from "react-intersection-observer";
import type { OnlineState } from "../../../store/friends-store";
import { usePlayerAvatar } from "../../../hooks/usePlayerAvatar";
import { statusMeta } from "./status";

interface PlayerAvatarProps {
  uuid: string | null | undefined;
  name?: string;
  size: number;
  status?: OnlineState;
  /** The player's own avatar, so Invisible is not shown as Offline. */
  self?: boolean;
  /** Ring color around the status dot. */
  ringColor?: string;
  dim?: boolean;
}

// One size everywhere, so the render cache is shared.
const RENDER_SIZE = 64;

export const PlayerAvatar = memo(function PlayerAvatar({
  uuid,
  name,
  size,
  status,
  self = false,
  ringColor,
  dim = false,
}: PlayerAvatarProps) {
  // Only fetch visible avatars: loading a long list at once hits Mojang's rate limit (429).
  const { ref, inView } = useInView({ triggerOnce: true, rootMargin: "120px 0px" });
  const url = usePlayerAvatar({ uuid: inView ? uuid : null, size: RENDER_SIZE });

  return (
    <span
      ref={ref}
      className="fw-avatar"
      data-dim={dim}
      style={{ width: size, height: size }}
    >
      {url ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        <span className="fw-avatar-fallback" style={{ fontSize: Math.round(size * 0.42) }}>
          {name?.charAt(0).toUpperCase() ?? ""}
        </span>
      )}
      {status && (
        <span
          className="fw-status-dot"
          style={{
            backgroundColor: statusMeta(status, self).color,
            ...(ringColor ? { ["--fw-dot-ring" as string]: ringColor } : {}),
          }}
        />
      )}
    </span>
  );
});
