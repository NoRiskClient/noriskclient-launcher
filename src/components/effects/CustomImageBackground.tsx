import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@iconify/react";

interface CustomImageBackgroundProps {
  imagePath: string | null;
  opacity: number;
  blur: number;
  scale: number;
}

const CustomImageBackground: React.FC<CustomImageBackgroundProps> = ({
  imagePath,
  opacity,
  blur,
  scale,
}) => {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadImage = async () => {
      if (!imagePath) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        const base64Data = await invoke<string>("load_image_as_base64", {
          imagePath: imagePath,
        });
        
        setImageDataUrl(base64Data);
        console.log("Custom background image loaded successfully as base64");
      } catch (err) {
        console.error("Failed to load custom background image:", err);
        setError(err as string);
      } finally {
        setLoading(false);
      }
    };

    loadImage();
  }, [imagePath]);

  if (!imagePath) {
    return (
      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
        <div className="text-center text-white/50">
          <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <svg className="w-full h-full" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
            </svg>
          </div>
          <p className="text-lg font-minecraft">No custom image selected</p>
          <p className="text-sm font-minecraft-ten">Go to Settings → Background to select an image</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
        <div className="text-center text-white/50">
          <Icon icon="solar:loading-bold" className="w-16 h-16 mx-auto mb-4 animate-spin" />
          <p className="text-lg font-minecraft">Loading background image...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
        <div className="text-center text-white/50">
          <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <svg className="w-full h-full" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
            </svg>
          </div>
          <p className="text-lg font-minecraft">Failed to load custom image</p>
          <p className="text-sm font-minecraft-ten">Check file path and format</p>
        </div>
      </div>
    );
  }

  if (!imageDataUrl) {
    return (
      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
        <div className="text-center text-white/50">
          <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <svg className="w-full h-full" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
            </svg>
          </div>
          <p className="text-lg font-minecraft">No image data</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="absolute inset-0 w-full h-full transition-all duration-500"
      style={{
        backgroundImage: `url("${imageDataUrl}")`,
        backgroundSize: `${100 * scale}%`,
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        opacity: opacity,
        filter: `blur(${blur}px)`,
      }}
    />
  );
};

export default CustomImageBackground;
