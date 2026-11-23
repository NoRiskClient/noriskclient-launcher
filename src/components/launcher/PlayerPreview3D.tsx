import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { SkinRenderer } from "@noriskclient/nrc-skin-renderer/react";
import { WebGLBoundary } from "../WebGLBoundary";
import { IconButton } from "../ui/buttons/IconButton";
import { CapeImage } from "../capes/CapeImage";
import type { SkinVariant } from "../../types/localSkin";
import { useIdleEmote } from "../../hooks/useIdleEmote";

const FILL_STYLE = { width: "100%", height: "100%" };
const NO_COSMETICS: never[] = [];

interface PlayerPreview3DProps {
  skinUrl: string | null;
  variant?: SkinVariant;
  capeUrl?: string | null;
  height?: number | "fill";
  facing?: "front" | "back";
}

export function PlayerPreview3D({ skinUrl, variant, capeUrl = null, height = "fill", facing = "front" }: PlayerPreview3DProps) {
  const { t } = useTranslation();
  const [showElytra, setShowElytra] = useState(false);
  const idleEmote = useIdleEmote();
  const cape = useMemo(() => (capeUrl ? { texture: capeUrl, elytra: showElytra } : undefined), [capeUrl, showElytra]);
  const elytraLabel = showElytra ? t("capes.showAsCape") : t("capes.showAsElytra");

  return (
    <div
      className={height === "fill" ? "relative w-full flex-1 min-h-[200px]" : "relative w-full shrink-0"}
      style={height === "fill" ? undefined : { height }}
    >
      {capeUrl && (
        <IconButton
          onClick={() => setShowElytra((value) => !value)}
          variant="ghost"
          size="sm"
          className="absolute top-0 right-0 z-10"
          icon={<Icon icon={showElytra ? "ph:airplane-tilt-fill" : "ph:airplane-tilt-duotone"} className="w-5 h-5" />}
          title={elytraLabel}
          aria-label={elytraLabel}
        />
      )}
      {skinUrl && (
        <WebGLBoundary
          label="player preview"
          fallback={capeUrl ? <CapeImage imageUrl={capeUrl} part="back" width={140} /> : null}
        >
          <SkinRenderer
            key={variant ?? "auto"}
            textureUrl={skinUrl}
            variant={variant ?? "auto"}
            cosmetics={NO_COSMETICS}
            cape={cape}
            rotation={facing === "back" ? Math.PI : 0}
            draggable
            emote={idleEmote.urls}
            emoteLoop={idleEmote.loop}
            onEmoteEnd={idleEmote.onEnd}
            zoom={1.9}
            fps={30}
            style={FILL_STYLE}
          />
        </WebGLBoundary>
      )}
    </div>
  );
}
