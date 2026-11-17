import { useMemo } from "react";
import { Lightning } from "./Lightning";
import { useThemeStore } from "../../store/useThemeStore";
import { useQualitySettingsStore } from "../../store/quality-settings-store";

interface NebulaLightningProps {
  speed?: number;
  intensity?: number;
  size?: number;
  xOffset?: number;
  opacity?: number;
  className?: string;
}

export function NebulaLightning({
  speed = 0.8,
  intensity = 1.2,
  size = 1.5,
  xOffset = 0,
  opacity = 0.7,
  className = "",
}: NebulaLightningProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const { qualityLevel } = useQualitySettingsStore();

  const qualityMultiplier =
    qualityLevel === "low" ? 0.5 : qualityLevel === "high" ? 1.5 : 1;
  const adjustedSpeed = speed * qualityMultiplier;
  const adjustedIntensity = intensity * qualityMultiplier;

  const hue = useMemo(() => {
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? {
            r: Number.parseInt(result[1], 16),
            g: Number.parseInt(result[2], 16),
            b: Number.parseInt(result[3], 16),
          }
        : { r: 0, g: 0, b: 0 };
    };

    const rgbToHsl = (r: number, g: number, b: number) => {
      r /= 255;
      g /= 255;
      b /= 255;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      let h = 0;
      let s = 0;
      const l = (max + min) / 2;

      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
          case r:
            h = (g - b) / d + (g < b ? 6 : 0);
            break;
          case g:
            h = (b - r) / d + 2;
            break;
          case b:
            h = (r - g) / d + 4;
            break;
        }

        h *= 60;
      }

      return { h, s, l };
    };

    const rgb = hexToRgb(accentColor.value);
    const { h } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    return h;
  }, [accentColor.value]);

  return (
    <div className={`absolute inset-0 ${className}`} style={{ opacity }}>
      <Lightning
        hue={hue}
        speed={adjustedSpeed}
        intensity={adjustedIntensity}
        size={size}
        xOffset={xOffset}
      />
    </div>
  );
}
