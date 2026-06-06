"use client";

import { useMemo } from "react";

import { useFrame } from "@react-three/fiber";

import type { LoadedCosmetic } from "../core/loadCosmetic";
import {
  applyRuntimeAnimation,
  type RuntimeAnimation,
} from "../core/runtimeAnimation";

interface AnimationDriverProps {
  cosmetic: LoadedCosmetic;
  /** Animation name to play. Falls back to "nrc.idle" then the first one. */
  animationName?: string;
}

/**
 * Drives a cosmetic's runtime animation + animated PNG texture each frame.
 * Renders no DOM — pair with a separate `<primitive object={cosmetic.tree.root} />`
 * so the caller is free to wrap the tree with whatever transform chain they
 * want (e.g. `buildPreviewTransform` in standalone mode, fixed offsets in
 * Steve mode).
 */
export function CosmeticAnimationDriver({
  cosmetic,
  animationName,
}: AnimationDriverProps) {
  const activeAnim: RuntimeAnimation | null = useMemo(() => {
    if (cosmetic.animations.length === 0) return null;
    return (
      (animationName &&
        cosmetic.animations.find((a) => a.name === animationName)) ||
      cosmetic.animations.find((a) => a.name === "nrc.idle") ||
      cosmetic.animations[0]
    );
  }, [cosmetic, animationName]);

  useFrame((state) => {
    const elapsed = state.clock.elapsedTime;

    if (activeAnim) {
      applyRuntimeAnimation(activeAnim, elapsed, {
        negateX: cosmetic.config.negateX,
      });
    }

    // Step animated PNGs (.png.mcmeta) by walking the vertical frame strip.
    // NRC's NrcFrameAnimator treats `frametime` as raw milliseconds (not
    // MC ticks): `nextUpdate = currentTimeMillis() + frametime`. So 1 unit
    // = 1 ms. offset.y points at the current frame's top edge.
    const texAnim = cosmetic.textureAnimation;
    if (texAnim) {
      const frameSeconds = texAnim.frametime * 0.001;
      const idxInArray =
        Math.floor(elapsed / frameSeconds) % texAnim.frames.length;
      const frameIndex = texAnim.frames[idxInArray];
      const nextOffset = frameIndex * texAnim.frameUvHeight;
      if (cosmetic.texture.offset.y !== nextOffset) {
        cosmetic.texture.offset.y = nextOffset;
      }
    }
  });

  return null;
}

interface ModelProps {
  cosmetic: LoadedCosmetic;
  animationName?: string;
}

/**
 * Convenience: mounts the cosmetic tree as a primitive AND drives its animation.
 * Wraps no transforms — the caller positions/scales the surrounding group.
 */
export function CosmeticGeoModel({ cosmetic, animationName }: ModelProps) {
  return (
    <>
      <primitive object={cosmetic.tree.root} />
      <CosmeticAnimationDriver cosmetic={cosmetic} animationName={animationName} />
    </>
  );
}
