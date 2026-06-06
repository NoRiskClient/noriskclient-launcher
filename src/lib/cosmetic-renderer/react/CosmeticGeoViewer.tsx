"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import {
  disposeLoadedCosmetic,
  loadCosmetic,
  type CosmeticAssetUrls,
  type LoadedCosmetic,
  type RenderConfig,
} from "../core/loadCosmetic";

import { SteveRig } from "./SteveRig";

export type CosmeticGeoViewerMode = "standalone" | "steve";

export type CosmeticGeoViewerCamera = {
  /** Static Y rotation in radians. */
  rotY?: number;
  /** Camera distance on the Z axis. */
  camZ?: number;
  /** Camera height on the Y axis. */
  camY?: number;
  /** Y coordinate the camera looks at. */
  lookAtY?: number;
  /** Perspective camera field of view. */
  fov?: number;
};

const DEFAULT_CAMERA: Required<CosmeticGeoViewerCamera> = {
  rotY: 0,
  camZ: 3,
  camY: 0,
  lookAtY: 0,
  fov: 40,
};

const CAMERA_MORPH_SPEED = 4.5;

interface Props {
  /** Resolved URLs for the cosmetic's asset files. */
  urls: CosmeticAssetUrls;
  /** Render-pipeline knobs (negateX, armorOnly). Defaults match NRC reference. */
  config?: RenderConfig;
  /** Layout mode. "standalone" shows just the cosmetic; "steve" mounts it on a Steve skeleton. */
  mode?: CosmeticGeoViewerMode;
  /** Clip name to play. Defaults to "nrc.idle" or first clip. */
  animationName?: string;
  /** Y-rotation rate in rad/s. 0 disables. */
  spinSpeed?: number;
  /** Optional player skin texture URL for `mode="steve"`. */
  steveTextureUrl?: string | null;
  /** Called when the Steve texture has loaded or failed. */
  onSteveTextureLoaded?: () => void;
  /** Additional cosmetics to load and retain for instant switching. */
  preloadUrls?: CosmeticAssetUrls[];
  /** Optional preview camera overrides. Omit to keep renderer defaults. */
  camera?: CosmeticGeoViewerCamera;
  /** When false, skip the bbox-fit safety net so the Steve mannequin renders
   * at a constant scale across cosmetics. Useful for uniform grid previews. */
  fitToViewport?: boolean;
  /** Optional marker on Steve's face to make the front direction obvious. */
  className?: string;
}

/**
 * Drop-in `<canvas>` component that renders one cosmetic. Handles loading,
 * disposal, lighting, camera, and the standalone-vs-steve layout switch.
 *
 * The `urls` prop should be stable across renders — wrap construction in
 * `useMemo` if you build it inline.
 */
export function CosmeticGeoViewer({
  urls,
  config,
  mode = "standalone",
  animationName,
  spinSpeed = 0.6,
  steveTextureUrl,
  onSteveTextureLoaded,
  preloadUrls,
  camera,
  fitToViewport,
  className,
}: Props) {
  return (
    <div
      className={className}
      style={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        height: "100%",
      }}
    >
      <Canvas
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        camera={{ position: [0, 0, 3], fov: 40, near: 0.01, far: 100 }}
        gl={{ antialias: true, alpha: true }}
      >
        <CameraController camera={camera} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 3, 2]} intensity={1.2} />
        <directionalLight position={[-2, 2, 2]} intensity={0.6} />
        <Suspense fallback={null}>
          <CosmeticScene
            urls={urls}
            config={config}
            mode={mode}
            animationName={animationName}
            spinSpeed={spinSpeed}
            steveTextureUrl={steveTextureUrl}
            onSteveTextureLoaded={onSteveTextureLoaded}
            preloadUrls={preloadUrls}
            rotationY={camera?.rotY}
            fitToViewport={fitToViewport}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

interface SceneProps {
  urls: CosmeticAssetUrls;
  config?: RenderConfig;
  mode: CosmeticGeoViewerMode;
  animationName?: string;
  spinSpeed: number;
  steveTextureUrl?: string | null;
  onSteveTextureLoaded?: () => void;
  preloadUrls?: CosmeticAssetUrls[];
  rotationY?: number;
  fitToViewport?: boolean;
}

function CosmeticScene({
  urls,
  config,
  mode,
  animationName,
  spinSpeed,
  steveTextureUrl,
  onSteveTextureLoaded,
  preloadUrls,
  rotationY,
  fitToViewport,
}: SceneProps) {
  const cosmetic = usePreloadedCosmetic(urls, preloadUrls, config);
  if (!cosmetic) return null;

  // "standalone" reuses the Steve rig with the mannequin hidden. This makes
  // the cosmetic appear at exactly the world position it would occupy when
  // worn ingame — bone pivots are authored relative to a player skeleton, so
  // rendering them without that skeleton drops the cosmetic to feet level
  // (e.g. back/guitar's bone pivot at y=0 = floor). With a hidden Steve, the
  // skeleton is implicit and the cosmetic positions correctly.
  return (
    <SteveRig
      cosmetic={cosmetic}
      animationName={animationName}
      spinSpeed={spinSpeed}
      rotationY={rotationY ?? DEFAULT_CAMERA.rotY}
      hideSteve={mode === "standalone"}
      steveTextureUrl={steveTextureUrl}
      onSteveTextureLoaded={onSteveTextureLoaded}
      fitToViewport={fitToViewport}
    />
  );
}

function CameraController({
  camera,
}: {
  camera?: CosmeticGeoViewerCamera;
}) {
  const { camera: threeCamera } = useThree();
  const camZ = camera?.camZ ?? DEFAULT_CAMERA.camZ;
  const camY = camera?.camY ?? DEFAULT_CAMERA.camY;
  const lookAtY = camera?.lookAtY ?? DEFAULT_CAMERA.lookAtY;
  const fov = camera?.fov ?? DEFAULT_CAMERA.fov;
  const currentRef = useRef({ camZ, camY, lookAtY, fov });

  useFrame((_, delta) => {
    const current = currentRef.current;
    current.camZ = THREE.MathUtils.damp(
      current.camZ,
      camZ,
      CAMERA_MORPH_SPEED,
      delta
    );
    current.camY = THREE.MathUtils.damp(
      current.camY,
      camY,
      CAMERA_MORPH_SPEED,
      delta
    );
    current.lookAtY = THREE.MathUtils.damp(
      current.lookAtY,
      lookAtY,
      CAMERA_MORPH_SPEED,
      delta
    );
    current.fov = THREE.MathUtils.damp(
      current.fov,
      fov,
      CAMERA_MORPH_SPEED,
      delta
    );

    threeCamera.position.set(0, current.camY, current.camZ);
    threeCamera.lookAt(0, current.lookAtY, 0);

    if (threeCamera instanceof THREE.PerspectiveCamera) {
      threeCamera.fov = current.fov;
      threeCamera.updateProjectionMatrix();
    }
  });

  return null;
}

function usePreloadedCosmetic(
  activeUrls: CosmeticAssetUrls,
  preloadUrls: CosmeticAssetUrls[] | undefined,
  config: RenderConfig | undefined
): LoadedCosmetic | null {
  const [, forceUpdate] = useState(0);
  const loadedRef = useRef(new Map<string, LoadedCosmetic>());
  const inFlightRef = useRef(new Set<string>());
  const lastReadyRef = useRef<LoadedCosmetic | null>(null);
  const mountedRef = useRef(true);
  const wantedKeysRef = useRef(new Set<string>());

  const entries = useMemo(() => {
    const byKey = new Map<string, CosmeticAssetUrls>();
    byKey.set(cosmeticCacheKey(activeUrls, config), activeUrls);
    for (const urls of preloadUrls ?? []) {
      byKey.set(cosmeticCacheKey(urls, config), urls);
    }
    return [...byKey.entries()].map(([key, urls]) => ({ key, urls }));
  }, [activeUrls, preloadUrls, config]);

  const activeKey = cosmeticCacheKey(activeUrls, config);
  const entriesSignature = entries.map((entry) => entry.key).join("\n");

  useEffect(() => {
    const wantedKeys = new Set(entries.map((entry) => entry.key));
    wantedKeysRef.current = wantedKeys;

    for (const [key, cosmetic] of loadedRef.current) {
      if (wantedKeys.has(key)) continue;
      loadedRef.current.delete(key);
      disposeLoadedCosmetic(cosmetic);
    }

    for (const entry of entries) {
      if (loadedRef.current.has(entry.key) || inFlightRef.current.has(entry.key)) {
        continue;
      }

      inFlightRef.current.add(entry.key);
      loadCosmetic(entry.urls, config).then(
        (cosmetic) => {
          inFlightRef.current.delete(entry.key);
          if (!mountedRef.current || !wantedKeysRef.current.has(entry.key)) {
            disposeLoadedCosmetic(cosmetic);
            return;
          }
          loadedRef.current.set(entry.key, cosmetic);
          forceUpdate((version) => version + 1);
        },
        () => {
          inFlightRef.current.delete(entry.key);
        }
      );
    }
  }, [entries, entriesSignature, config]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      for (const cosmetic of loadedRef.current.values()) {
        disposeLoadedCosmetic(cosmetic);
      }
      loadedRef.current.clear();
      inFlightRef.current.clear();
      lastReadyRef.current = null;
    };
  }, []);

  const activeCosmetic = loadedRef.current.get(activeKey) ?? null;
  if (activeCosmetic) {
    lastReadyRef.current = activeCosmetic;
    return activeCosmetic;
  }

  return lastReadyRef.current;
}

function cosmeticCacheKey(
  urls: CosmeticAssetUrls,
  config: RenderConfig | undefined
): string {
  return JSON.stringify({
    config: {
      negateX: config?.negateX,
      armorOnly: config?.armorOnly,
    },
    geo: urls.geo,
    texture: urls.texture,
    animation: urls.animation,
    metadata: urls.metadata,
    metadataJson: urls.metadataJson,
    mcmeta: urls.mcmeta,
    mcmetaJson: urls.mcmetaJson,
    particles: urls.particles?.map((particle) => particle.jsonUrl),
  });
}
