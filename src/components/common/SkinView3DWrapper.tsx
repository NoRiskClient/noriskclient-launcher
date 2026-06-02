'use client';

import React, { useEffect, useRef } from 'react';
import * as skinview3d from 'skinview3d';
import { cn } from '../../lib/utils';

interface SkinView3DWrapperProps {
  skinUrl?: string | null;
  capeUrl?: string | null;
  skinVariant?: 'classic' | 'slim';
  className?: string;
  width?: number;
  height?: number;
  enableAutoRotate?: boolean;
  zoom?: number;
  displayAsElytra?: boolean;
  onPaintPixel?: (x: any, y: any) => void;
  autoRotateSpeed?: number;
  startFromBack?: boolean;
  rotationY?: number;
  animationType?: 'idle' | 'walk' | 'run' | 'fly' | 'none';
  spreadLegs?: boolean;
}


const DEFAULT_STEVE_SKIN_URL = 'https://api.mineatar.com/skin/Steve';

const getModelOption = (variant: 'classic' | 'slim' | undefined): { model?: 'slim' | 'default' } => {
  if (variant === 'slim') return { model: 'slim' };
  if (variant === 'classic') return { model: 'default' };
  return {};
};

export const SkinView3DWrapper: React.FC<SkinView3DWrapperProps> = ({
  skinUrl,
  capeUrl,
  skinVariant,
  className,
  width: propWidth,
  height: propHeight,
  enableAutoRotate = false,
  zoom = 1.0,
  displayAsElytra = false,
  autoRotateSpeed = 1.0,
  startFromBack = false,
  rotationY,
  animationType,
  spreadLegs = false,
}) => {
  console.log("[SkinView3D] Component props:", {
    skinUrl: skinUrl ? (typeof skinUrl === 'string' ? skinUrl.substring(0, 50) + "..." : skinUrl) : null,
    skinVariant,
    enableAutoRotate,
    zoom
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const skinViewerRef = useRef<skinview3d.SkinViewer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return () => {};

    const determineWidth = propWidth || containerRef.current.offsetWidth || 300;
    const determineHeight = propHeight || containerRef.current.offsetHeight || 400;

    const viewer = new skinview3d.SkinViewer({
      canvas: canvasRef.current,
      width: determineWidth,
      height: determineHeight,
      skin: skinUrl === null ? undefined : (skinUrl || DEFAULT_STEVE_SKIN_URL),
    });

    skinViewerRef.current = viewer;

    const modelOption = getModelOption(skinVariant);
    if (skinUrl === null) {
      viewer.loadSkin(null);
    } else if (skinUrl) {
      viewer.loadSkin(skinUrl, modelOption);
    } else if (DEFAULT_STEVE_SKIN_URL) {
      viewer.loadSkin(DEFAULT_STEVE_SKIN_URL, modelOption);
    }

    if (capeUrl) {
      viewer.loadCape(capeUrl, displayAsElytra ? { backEquipment: "elytra" } : undefined);
    }
    viewer.autoRotate = enableAutoRotate;
    if (enableAutoRotate && autoRotateSpeed !== 1.0) {
      viewer.autoRotateSpeed = autoRotateSpeed;
    }
    viewer.zoom = zoom;

    const animType = animationType || 'none';
    if (animType === 'run') {
      viewer.animation = new skinview3d.RunningAnimation();
    } else if (animType === 'fly') {
      viewer.animation = new skinview3d.FlyingAnimation();
    } else if (animType === 'walk') {
      viewer.animation = new skinview3d.WalkingAnimation();
    } else {
      viewer.animation = new skinview3d.IdleAnimation();
    }
    
    if (viewer.playerObject) {
      if (rotationY !== undefined) {
        viewer.playerObject.rotation.y = rotationY;
      } else if (startFromBack) {
        viewer.playerObject.rotation.y = Math.PI; 
      }
    }

    if (spreadLegs && viewer.playerObject) {
      viewer.playerObject.skin.rightLeg.rotation.x = -0.3;
      viewer.playerObject.skin.leftLeg.rotation.x = 0.3;
    }

    const targetRotY = rotationY !== undefined ? rotationY : (startFromBack ? Math.PI : 0);
    const defaultCamPos = { x: viewer.camera.position.x, y: viewer.camera.position.y, z: viewer.camera.position.z };
    const defaultCamTarget = { x: viewer.controls.target.x, y: viewer.controls.target.y, z: viewer.controls.target.z };
    const defaultDx = defaultCamPos.x - defaultCamTarget.x;
    const defaultDy = defaultCamPos.y - defaultCamTarget.y;
    const defaultDz = defaultCamPos.z - defaultCamTarget.z;
    const defaultRadius = Math.sqrt(defaultDx * defaultDx + defaultDy * defaultDy + defaultDz * defaultDz);
    const defaultTheta = Math.atan2(defaultDz, defaultDx);
    const defaultPhi = Math.acos(defaultDy / defaultRadius);

    const onControlsEnd = () => {
      if (!viewer) return;
      const startTarget = { x: viewer.controls.target.x, y: viewer.controls.target.y, z: viewer.controls.target.z };
      const dx = viewer.camera.position.x - viewer.controls.target.x;
      const dy = viewer.camera.position.y - viewer.controls.target.y;
      const dz = viewer.camera.position.z - viewer.controls.target.z;
      const radius = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const startTheta = Math.atan2(dz, dx);
      const startPhi = Math.acos(dy / radius);
      const startPlayerRot = viewer.playerObject.rotation.y;
      const duration = 400;
      const startTime = performance.now();

      const snap = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);

        viewer.playerObject.rotation.y = startPlayerRot + (targetRotY - startPlayerRot) * ease;

        viewer.controls.target.x = startTarget.x + (defaultCamTarget.x - startTarget.x) * ease;
        viewer.controls.target.y = startTarget.y + (defaultCamTarget.y - startTarget.y) * ease;
        viewer.controls.target.z = startTarget.z + (defaultCamTarget.z - startTarget.z) * ease;

        const theta = startTheta + (defaultTheta - startTheta) * ease;
        const phi = startPhi + (defaultPhi - startPhi) * ease;
        const sinPhi = Math.sin(phi);
        viewer.camera.position.set(
          viewer.controls.target.x + radius * sinPhi * Math.cos(theta),
          viewer.controls.target.y + radius * Math.cos(phi),
          viewer.controls.target.z + radius * sinPhi * Math.sin(theta)
        );
        viewer.controls.update();

        if (t < 1) {
          requestAnimationFrame(snap);
        }
      };
      snap();
    };

    viewer.controls.addEventListener('end', onControlsEnd);

    const resizeObserver = new ResizeObserver(entries => {
      if (!skinViewerRef.current) return;
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (!propWidth) skinViewerRef.current.width = width;
        if (!propHeight) skinViewerRef.current.height = height;
      }
    });

    if (!propWidth || !propHeight) {
       resizeObserver.observe(containerRef.current);
    }

    return () => {
      viewer.controls.removeEventListener('end', onControlsEnd);
      resizeObserver.disconnect();
      if (skinViewerRef.current) {
      
        skinViewerRef.current = null;
      }
    };

  }, [propWidth, propHeight, enableAutoRotate, zoom, rotationY, startFromBack, animationType, spreadLegs]);

  useEffect(() => {
    if (skinViewerRef.current?.playerObject && rotationY !== undefined) {
      skinViewerRef.current.playerObject.rotation.y = rotationY;
    }
  }, [rotationY]);

 
  useEffect(() => {
    if (skinViewerRef.current) {
      const modelOption = getModelOption(skinVariant);
      if (skinUrl === null) {
        skinViewerRef.current.loadSkin(null);
      } else if (skinUrl) {
        skinViewerRef.current.loadSkin(skinUrl, modelOption);
      } else {
        skinViewerRef.current.loadSkin(DEFAULT_STEVE_SKIN_URL, modelOption);
      }
    }
  }, [skinUrl]);

  // Separate useEffect for skinVariant changes only
  useEffect(() => {
    if (skinViewerRef.current && skinUrl) {
      const modelOption = getModelOption(skinVariant);
      console.log(`[SkinView3D] Changing model to: ${JSON.stringify(modelOption)} for variant: ${skinVariant}`);
      skinViewerRef.current.loadSkin(skinUrl, modelOption);
    }
  }, [skinVariant]);

  useEffect(() => {
    if (skinViewerRef.current) {
      if (capeUrl === null) {
        skinViewerRef.current.loadCape(null);
      } else if (capeUrl) {
        skinViewerRef.current.loadCape(capeUrl, displayAsElytra ? { backEquipment: "elytra" } : undefined);
      }
    }
  }, [capeUrl, displayAsElytra]);

  useEffect(() => {
    if (skinViewerRef.current) {
      skinViewerRef.current.autoRotate = enableAutoRotate;
    }
  }, [enableAutoRotate]);

  useEffect(() => {
    if (skinViewerRef.current) {
      skinViewerRef.current.zoom = zoom;
    }
  }, [zoom]);

  useEffect(() => {
    if (skinViewerRef.current?.playerObject) {
      if (spreadLegs) {
        skinViewerRef.current.playerObject.skin.rightLeg.rotation.x = -0.3;
        skinViewerRef.current.playerObject.skin.leftLeg.rotation.x = 0.3;
      } else {
        skinViewerRef.current.playerObject.skin.rightLeg.rotation.x = 0;
        skinViewerRef.current.playerObject.skin.leftLeg.rotation.x = 0;
      }
    }
  }, [spreadLegs]);

  return (
    <div ref={containerRef} className={cn("w-full h-full", className)}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}; 
