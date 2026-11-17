import React, { useEffect, useRef, useState, useMemo } from 'react';
import { cn } from '../../lib/utils';

interface CapeImageProps {
  imageUrl: string | undefined;
  part?: 'front' | 'back';
  width?: number;
  className?: string;
}

// Constants for cape layout (scaled for a common cape texture size like 64x32, but source image is expected to be larger and detailed)
// The Svelte example used a 512x256 source assumption with SCALE_FACTOR = 8
// For a typical 64x32 Minecraft cape texture, parts are:
// Front: x=1, y=1, w=10, h=16 (scaled from texture pixels)
// Back:  x=12, y=1, w=10, h=16 (scaled from texture pixels)
// We need to ensure these source coordinates (sx, sy, sWidth, sHeight) correctly sample from the actual image.
// The provided svelte code assumes a source image where these parts are at a larger scale.
// Let's stick to the Svelte's scaled coordinates if the source images are indeed high-resolution like that.

const SVELTE_SCALE_FACTOR = 8; // Re-introduce Svelte's scale factor
const CAPE_PART_SRC_WIDTH = 10 * SVELTE_SCALE_FACTOR; // 80
const CAPE_PART_SRC_HEIGHT = 16 * SVELTE_SCALE_FACTOR; // 128
const FRONT_X = 1 * SVELTE_SCALE_FACTOR;  // 8
const FRONT_Y = 1 * SVELTE_SCALE_FACTOR;  // 8
const BACK_X = 12 * SVELTE_SCALE_FACTOR; // 96 (1 + 10 + 1 offset in Svelte example)
const BACK_Y = 1 * SVELTE_SCALE_FACTOR;  // 8


export const CapeImage = React.memo(function CapeImage({
  imageUrl,
  part = 'front',
  width = 60, // Default width
  className,
}: CapeImageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Calculate height based on width and cape aspect ratio (10:16 for the part)
  const height = useMemo(() => Math.round(width * (CAPE_PART_SRC_HEIGHT / CAPE_PART_SRC_WIDTH)), [width]);

  useEffect(() => {
    setIsLoading(true);
    setErrorMessage(null);
    
    const canvas = canvasRef.current;
    if (!canvas) {
      // console.warn("[CapeImage] Effect ran before canvas was ready.");
      setIsLoading(false); // Not strictly an error, but can't proceed
      return;
    }

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    if (!imageUrl) {
      // console.log("[CapeImage] No imageUrl provided.");
      setIsLoading(false); // Nothing to load
      return;
    }

    // console.log(`[CapeImage] Loading ${part} from ${imageUrl} for canvas ${width}x${height}`);
    const img = new Image();
    img.crossOrigin = 'anonymous'; 
    img.src = imageUrl;

    const onLoad = () => {
      // console.log("[CapeImage] Image loaded.");
      if (!canvasRef.current) { // Check if canvas is still there
        // console.error("[CapeImage] Canvas lost before drawing.");
        setErrorMessage("Canvas lost before drawing.");
        setIsLoading(false);
        return;
      }
      const currentCtx = canvasRef.current.getContext('2d');
      if (!currentCtx) {
        setErrorMessage("Failed to get canvas context for drawing.");
        setIsLoading(false);
        return;
      }

      try {
        const sx = part === 'back' ? BACK_X : FRONT_X;
        const sy = part === 'back' ? BACK_Y : FRONT_Y;
        
        currentCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        currentCtx.imageSmoothingEnabled = false; // Pixelated look

        currentCtx.drawImage(
          img,
          sx, sy, CAPE_PART_SRC_WIDTH, CAPE_PART_SRC_HEIGHT, // Source rectangle
          0, 0, canvasRef.current.width, canvasRef.current.height  // Destination rectangle
        );
        // console.log(`[CapeImage] Drawn ${part} part.`);
        setErrorMessage(null);
      } catch (drawError) {
        console.error("[CapeImage] Error drawing cape part:", drawError);
        setErrorMessage("Error rendering cape part.");
      } finally {
        setIsLoading(false);
      }
    };

    const onError = (error: string | Event) => {
      console.error("[CapeImage] Failed to load cape image:", imageUrl, error);
      setErrorMessage("Failed to load cape image.");
      setIsLoading(false);
    };
    
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);

    return () => {
      // console.log("[CapeImage] Cleanup effect for:", imageUrl);
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
    };
  }, [imageUrl, part, width, height]); // Rerun effect if these change

  return (
    <div 
      className={cn("cape-image-container relative inline-block align-middle overflow-hidden", className)} 
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      {errorMessage ? (
        <div 
          className="error-message w-full h-full flex justify-center items-center text-center text-xs text-red-600 bg-red-100 border border-red-600 p-1 box-border"
          title={errorMessage}
        >
          ⚠️ Error
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className={cn(
            "cape-canvas block w-full h-full image-pixelated transition-opacity duration-300 ease-in-out",
            isLoading && !errorMessage ? "opacity-0" : "opacity-100"
          )}
          title={`Cape ${part} view`}
          style={{ backgroundColor: 'transparent' }}
        />
      )}
    </div>
  );
});

// CSS for image-pixelated could be in a global stylesheet or defined via a style tag / CSS-in-JS if preferred
// For Tailwind, it's often handled by browser defaults or specific image rendering utilities if available.
// The 'image-rendering: pixelated;' style is important.
// Adding a global style for this:
// <style jsx global>{`
//   .image-pixelated {
//     image-rendering: pixelated;
//     image-rendering: -moz-crisp-edges; /* Firefox */
//     image-rendering: crisp-edges; /* Old Edge, Safari */
//   }
// `}</style> 