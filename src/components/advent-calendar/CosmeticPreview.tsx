"use client";

import { useRef, useEffect, useState, Suspense, Component, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, OrbitControls, Center, Resize, Html, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { extendGLTFLoaderForTauri } from "../../utils/tauri-gltf-loader";
import { logInfo, logError } from "../../utils/logging-utils";

interface CosmeticPreviewProps {
  modelPath: string;
}

function Model({ modelPath }: { modelPath: string }) {
  // Extend the loader to handle Tauri asset URLs and relative paths
  const extendLoader = (loader: any) => {
    logInfo(`[CosmeticPreview] Extending GLTF loader for model: ${modelPath}`);
    extendGLTFLoaderForTauri(loader, modelPath);
  };

  const { scene, animations } = useGLTF(modelPath, false, false, extendLoader); 
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  useFrame((state, delta) => {
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }
  });

  useEffect(() => {
    if (animations && animations.length > 0) {
      const mixer = new THREE.AnimationMixer(scene);
      mixerRef.current = mixer;

      animations.forEach((clip) => {
        mixer.clipAction(clip).play();
      });

      return () => {
        mixer.stopAllAction();
      };
    }
  }, [animations, scene]);

  return <primitive object={scene} />;
}

function ErrorFallback({ error }: { error: Error }) {
  const { t } = useTranslation();
  return (
    <Html center>
      <div className="text-red-400 text-xs text-center p-2 bg-black/80 rounded border border-red-500/50">
        <p className="font-bold mb-1">{t('advent.model_error')}</p>
        <p>{error.message}</p>
      </div>
    </Html>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode, fallback: (props: { error: Error }) => ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError && this.state.error) {
      return this.props.fallback({ error: this.state.error });
    }
    return this.props.children;
  }
}

export function CosmeticPreview({ modelPath }: CosmeticPreviewProps) {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const loadingText = t('advent.loading_model');

  useEffect(() => {
    // Wait for the door animation to complete before rendering the 3D scene.
    // Door animation: 1s delay + 0.8s animation = ~1.8s total
    const t = setTimeout(() => setReady(true), 2000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="w-full h-full relative min-h-[250px]">
      {ready ? (
        <Canvas 
          shadows 
          dpr={[1, 2]} 
          camera={{ position: [0, 0, 6], fov: 50 }} 
          gl={{ alpha: true, preserveDrawingBuffer: true }}
        >
          <ambientLight intensity={0.6} />
          <hemisphereLight intensity={0.4} />
          <directionalLight position={[10, 10, 5]} intensity={1} />
          <directionalLight position={[-10, 5, -5]} intensity={0.5} />
          
          <ErrorBoundary fallback={ErrorFallback}>
            <Suspense fallback={
              <Html center>
                <div className="text-white/70 text-sm font-minecraft-ten">{loadingText}</div>
              </Html>
            }>
              <group position={[0, -0.5, 0]}>
                <Center>
                  <Resize scale={2.8}>
                    <Model modelPath={modelPath} />
                  </Resize>
                </Center>
                <ContactShadows position={[0, -0.8, 0]} opacity={0.4} scale={5} blur={2.5} far={4} />
              </group>
            </Suspense>
          </ErrorBoundary>
          
          <OrbitControls 
            autoRotate 
            autoRotateSpeed={4} 
            makeDefault 
            enableZoom={true}
            minDistance={2}
            maxDistance={12}
            zoomSpeed={0.8}
          />
        </Canvas>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-white/50 text-sm font-minecraft-ten">{loadingText}</div>
        </div>
      )}
    </div>
  );
}

