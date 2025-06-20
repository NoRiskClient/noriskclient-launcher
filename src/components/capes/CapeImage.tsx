'use client';

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

const SVELTE_SCALE_FACTOR = 8; 
const CAPE_PART_SRC_WIDTH = 10 * SVELTE_SCALE_FACTOR
const CAPE_PART_SRC_HEIGHT = 16 * SVELTE_SCALE_FACTOR; 
const FRONT_X = 1 * SVELTE_SCALE_FACTOR;  
const FRONT_Y = 1 * SVELTE_SCALE_FACTOR; 
const BACK_X = 12 * SVELTE_SCALE_FACTOR; 
const BACK_Y = 1 * SVELTE_SCALE_FACTOR;  


export const CapeImage = React.memo(function CapeImage({
  imageUrl,
  part = 'front',
  width = 60, 
  className,
}: CapeImageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);


  const height = useMemo(() => Math.round(width * (CAPE_PART_SRC_HEIGHT / CAPE_PART_SRC_WIDTH)), [width]);

  useEffect(() => {
    setIsLoading(true);
    setErrorMessage(null);
    
    const canvas = canvasRef.current;
    if (!canvas) {
    
      setIsLoading(false);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    if (!imageUrl) {
 
      setIsLoading(false); 
      return;
    }


    const img = new Image();
    img.crossOrigin = 'anonymous'; 
    img.src = imageUrl;

    const onLoad = () => {
      
      if (!canvasRef.current) { 
   
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
        currentCtx.imageSmoothingEnabled = false; 

        currentCtx.drawImage(
          img,
          sx, sy, CAPE_PART_SRC_WIDTH, CAPE_PART_SRC_HEIGHT, 
          0, 0, canvasRef.current.width, canvasRef.current.height  
        );
   
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
      
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
    };
  }, [imageUrl, part, width, height]); 

  return (
    <div 
      className={cn("cape-image-container relative inline-block align-middle overflow-hidden bg-black/10 rounded-sm", className)} 
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      {isLoading && !errorMessage && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <svg className="w-6 h-6 text-white/50 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
      )}
      {errorMessage && (
        <div 
          className="w-full h-full flex flex-col justify-center items-center text-center text-xs text-white/50 bg-black/20 p-1 box-border"
          title={errorMessage}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="font-minecraft-ten">Failed to load cape image :(</span>
        </div>
      )}
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className={cn(
            "cape-canvas block w-full h-full image-pixelated transition-opacity duration-300 ease-in-out",
            (isLoading || errorMessage) ? "opacity-0" : "opacity-100"
          )}
          title={`Cape ${part} view`}
          style={{ backgroundColor: 'transparent' }}
        />
    </div>
  );
});
