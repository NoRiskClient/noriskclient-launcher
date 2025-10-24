import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon } from "@iconify/react";

interface CustomImagePreviewProps {
  imagePath: string;
  opacity: number;
  blur: number;
  scale: number;
}

const CustomImagePreview: React.FC<CustomImagePreviewProps> = ({
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
      try {
        setLoading(true);
        setError(null);
        
        const base64Data = await invoke<string>("load_image_as_base64", {
          imagePath: imagePath,
        });
        
        setImageDataUrl(base64Data);
        console.log("Image loaded successfully as base64");
      } catch (err) {
        console.error("Failed to load image:", err);
        setError(err as string);
      } finally {
        setLoading(false);
      }
    };

    if (imagePath) {
      loadImage();
    }
  }, [imagePath]);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center text-white/70">
          <Icon icon="solar:loading-bold" className="w-8 h-8 mx-auto mb-2 animate-spin" />
          <p className="text-sm font-minecraft">Loading image...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center text-white/70">
          <Icon icon="solar:gallery-bold" className="w-8 h-8 mx-auto mb-2" />
          <p className="text-sm font-minecraft">Failed to load image</p>
          <p className="text-xs font-minecraft-ten">Check file path and format</p>
        </div>
      </div>
    );
  }

  if (!imageDataUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center text-white/70">
          <Icon icon="solar:gallery-bold" className="w-8 h-8 mx-auto mb-2" />
          <p className="text-sm font-minecraft">No image data</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-full h-full"
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

export default CustomImagePreview;
