'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { InView } from 'react-intersection-observer';

interface Cape3DRendererProps {
  imageUrl?: string;
  width?: number;
  height?: number;
  autoRotate?: boolean;
  backgroundColor?: string;
  isVisible?: boolean;
}

// Cape dimensions (scaled for Minecraft proportions)
const CAPE_BOX_WIDTH = 10;
const CAPE_BOX_HEIGHT = 16;
const CAPE_BOX_DEPTH = 1; // Give it some thickness

// Texture coordinates constants (assuming standard 64x32 cape texture)
const IMG_W = 64;
const IMG_H = 32;
const u_fn = (x: number) => x / IMG_W;
const v_fn = (y: number) => 1 - y / IMG_H; // Y is flipped

const T_RIGHT = [0, 1, 1, 16];
const T_FRONT = [1, 1, 10, 16];
const T_LEFT = [11, 1, 1, 16];
const T_BACK = [12, 1, 10, 16];
const T_TOP = [1, 0, 10, 1];
const T_BOTTOM = [11, 0, 10, 1];

export function Cape3DRenderer({
  imageUrl,
  width = 220, // Default width based on CapeCard context
  height = 176, // Default height based on CapeCard context
  autoRotate = false,
  backgroundColor = 'transparent', // Default to transparent for better card integration
  isVisible = true,
}: Cape3DRendererProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActuallyVisible, setIsActuallyVisible] = useState(false);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const capeMeshRef = useRef<THREE.Mesh | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const currentImageUrlRef = useRef<string | undefined>(imageUrl);

  const mapUV = useCallback((area: number[]) => [
    new THREE.Vector2(u_fn(area[0]), v_fn(area[1])),
    new THREE.Vector2(u_fn(area[0] + area[2]), v_fn(area[1])),
    new THREE.Vector2(u_fn(area[0]), v_fn(area[1] + area[3])),
    new THREE.Vector2(u_fn(area[0] + area[2]), v_fn(area[1] + area[3])),
  ], []);

  const cleanupThreeJs = useCallback(() => {
    if (animationFrameIdRef.current !== null) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    controlsRef.current?.dispose();
    rendererRef.current?.dispose();
    if (capeMeshRef.current) {
      sceneRef.current?.remove(capeMeshRef.current);
      capeMeshRef.current.geometry?.dispose();
      if (capeMeshRef.current.material instanceof THREE.Material) {
        capeMeshRef.current.material.dispose();
      } else if (Array.isArray(capeMeshRef.current.material)) {
        capeMeshRef.current.material.forEach((material) => material.dispose());
      }
      capeMeshRef.current = null;
    }
    sceneRef.current?.traverse(object => {
        if (object instanceof THREE.Mesh) {
            object.geometry?.dispose();
            if (Array.isArray(object.material)) {
                object.material.forEach(material => material.dispose());
            } else if (object.material) {
                object.material.dispose();
            }
        }
    });
    sceneRef.current?.clear();

    sceneRef.current = null;
    cameraRef.current = null;
    rendererRef.current = null;
    controlsRef.current = null;
  }, [imageUrl]);

  const createCapeModel = useCallback((texture: THREE.Texture) => {
    if (!sceneRef.current) return;

    const geometry = new THREE.BoxGeometry(CAPE_BOX_WIDTH, CAPE_BOX_HEIGHT, CAPE_BOX_DEPTH);
    const uv = geometry.attributes.uv as THREE.BufferAttribute;
    uv.needsUpdate = true;

    const uvOrder = [
      ...mapUV(T_RIGHT),
      ...mapUV(T_LEFT),
      ...mapUV(T_TOP),
      ...mapUV(T_BOTTOM),
      ...mapUV(T_FRONT),
      ...mapUV(T_BACK),
    ];

    for (let i = 0; i < uvOrder.length; i++) {
      uv.setXY(i, uvOrder[i].x, uvOrder[i].y);
    }

    const material = new THREE.MeshStandardMaterial({
      map: texture,
      side: THREE.FrontSide,
      transparent: true,
      alphaTest: 0.1,
    });

    capeMeshRef.current = new THREE.Mesh(geometry, material);
    capeMeshRef.current.position.set(0, 0, 0);
    // Add initial rotation for better 3D presentation
    capeMeshRef.current.rotation.y = Math.PI / 7; // Approx 25.7 degrees
    sceneRef.current.add(capeMeshRef.current);
  }, [mapUV]);

  const loadCapeTexture = useCallback(() => {
    if (!isActuallyVisible || !sceneRef.current || !imageUrl) {
      if (!imageUrl && isActuallyVisible) {
        setErrorMessage(t('capes.no_image_url'));
      }
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    currentImageUrlRef.current = imageUrl;

    const textureLoader = new THREE.TextureLoader();
    textureLoader.crossOrigin = 'anonymous';

    textureLoader.load(
      imageUrl,
      (texture: THREE.Texture) => {
        if (!isActuallyVisible || !sceneRef.current) return;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        if (capeMeshRef.current) {
            sceneRef.current.remove(capeMeshRef.current);
            capeMeshRef.current.geometry?.dispose();
             if (capeMeshRef.current.material instanceof THREE.Material) {
                capeMeshRef.current.material.dispose();
            } else if (Array.isArray(capeMeshRef.current.material)) {
                capeMeshRef.current.material.forEach((mat) => mat.dispose());
            }
            capeMeshRef.current = null;
        }
        createCapeModel(texture);
        setIsLoading(false);
      },
      undefined,
      (errorEvent: unknown) => {
        if (!isActuallyVisible) return;
        setErrorMessage(t('capes.texture_load_failed', { filename: imageUrl?.split('/').pop() }));
        setIsLoading(false);
      }
    );
  }, [imageUrl, createCapeModel, isActuallyVisible]);
  
  const animate = useCallback(() => {
    if (!isActuallyVisible || !sceneRef.current || !cameraRef.current || !rendererRef.current || !controlsRef.current) {
        if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
        return;
    }
    animationFrameIdRef.current = requestAnimationFrame(animate);
    controlsRef.current.update();
    rendererRef.current.render(sceneRef.current, cameraRef.current);
  }, [isActuallyVisible]);

  const initThreeJs = useCallback(() => {
    if (!canvasRef.current || !isActuallyVisible) return;

    sceneRef.current = new THREE.Scene();
    if (backgroundColor !== 'transparent') {
      sceneRef.current.background = new THREE.Color(backgroundColor);
    }

    const aspectRatio = width / height;
    cameraRef.current = new THREE.PerspectiveCamera(45, aspectRatio, 0.1, 1000);
    cameraRef.current.position.set(0, 0, 22);

    rendererRef.current = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: backgroundColor === 'transparent',
    });
    rendererRef.current.setSize(width, height);
    rendererRef.current.setPixelRatio(window.devicePixelRatio);

    controlsRef.current = new OrbitControls(cameraRef.current, rendererRef.current.domElement);
    controlsRef.current.enableDamping = true;
    controlsRef.current.dampingFactor = 0.05;
    controlsRef.current.autoRotate = autoRotate;
    controlsRef.current.autoRotateSpeed = 1.5;
    controlsRef.current.enableZoom = false;
    controlsRef.current.minDistance = 8;
    controlsRef.current.maxDistance = 40;
    controlsRef.current.minPolarAngle = Math.PI / 4;
    controlsRef.current.maxPolarAngle = 3 * Math.PI / 4;
    controlsRef.current.target.set(0, 0, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    sceneRef.current.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(3, 5, 4);
    sceneRef.current.add(directionalLight);
    const frontFill = new THREE.DirectionalLight(0xffffff, 0.8);
    frontFill.position.set(0, 1, 10);
    sceneRef.current.add(frontFill);
    const backLight = new THREE.DirectionalLight(0xffffff, 0.6);
    backLight.position.set(-3, 2, -5);
    sceneRef.current.add(backLight);

    loadCapeTexture();
    animate();

  }, [width, height, backgroundColor, autoRotate, animate, loadCapeTexture, isActuallyVisible, imageUrl]);

  useEffect(() => {
    if (isActuallyVisible) {
        if (!rendererRef.current) {
            initThreeJs();
        }
    } else {
        cleanupThreeJs();
    }
    return () => {
        if (isActuallyVisible) {
           cleanupThreeJs();
        }
    }
  }, [isActuallyVisible, initThreeJs, cleanupThreeJs]);

  useEffect(() => {
    if (isActuallyVisible && controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
    }
  }, [autoRotate, isActuallyVisible]);

  useEffect(() => {
    if (isActuallyVisible && rendererRef.current && cameraRef.current) {
        cameraRef.current.aspect = width / height;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(width, height);
    }
  }, [width, height, isActuallyVisible]);

  useEffect(() => {
    if (isActuallyVisible && imageUrl !== currentImageUrlRef.current && sceneRef.current) {
      if (capeMeshRef.current) {
        sceneRef.current.remove(capeMeshRef.current);
        capeMeshRef.current.geometry?.dispose();
        if (capeMeshRef.current.material instanceof THREE.Material) {
          capeMeshRef.current.material.dispose();
        } else if (Array.isArray(capeMeshRef.current.material)) {
          capeMeshRef.current.material.forEach((material) => material.dispose());
        }
        capeMeshRef.current = null;
      }
      loadCapeTexture();
    } else if (isActuallyVisible && imageUrl && !capeMeshRef.current && !isLoading) {
        loadCapeTexture();
    }
    currentImageUrlRef.current = imageUrl;
  }, [imageUrl, loadCapeTexture, isActuallyVisible, isLoading]);

  const handleVisibilityChange = (inView: boolean) => {
    setIsActuallyVisible(inView);
    if (!inView) {
        setIsLoading(true);
        setErrorMessage(null);
    }
  };

  return (
    <InView onChange={handleVisibilityChange} triggerOnce={false} rootMargin="200px 0px"> 
      {({ ref, inView }) => (
        <div ref={ref} className="relative w-full h-full" style={{ width: `${width}px`, height: `${height}px` }}>
          {!inView && (
             <div className="w-full h-full flex items-center justify-center bg-black/5">
                 <p className="text-xs text-white/30 font-minecraft">{t('common.loading_preview')}</p> 
             </div>
          )}
          {inView && errorMessage && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center bg-red-900/80 border border-red-700/80 text-red-300 p-2 rounded backdrop-blur-sm">
              <p className="font-bold text-sm">⚠️ {t('common.error')}</p>
              <p className="text-xs mt-1">{errorMessage}</p>
            </div>
          )}
          {inView && !errorMessage && (
            <canvas 
              ref={canvasRef} 
              className={`block w-full h-full ${(isLoading && !errorMessage) ? 'opacity-30' : ''} transition-opacity duration-300`}
              title="Cape 3D view"
            />
          )}
          {inView && isLoading && !errorMessage && (
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black/70 text-white px-3 py-1.5 rounded text-xs font-minecraft lowercase">
              {t('capes.loading_3d')}
            </div>
          )}
        </div>
      )}
    </InView>
  );
} 