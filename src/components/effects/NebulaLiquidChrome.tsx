import { useThemeStore } from "../../store/useThemeStore";
import { LiquidChrome } from "./LiquidChrome";
import { useQualitySettingsStore } from "../../store/quality-settings-store";

interface NebulaLiquidChromeProps {
  speed?: number;
  amplitude?: number;
  frequencyX?: number;
  frequencyY?: number;
  opacity?: number;
  className?: string;
}

export function NebulaLiquidChrome({
  speed = 0.2,
  amplitude = 0.5,
  frequencyX = 3,
  frequencyY = 2,
  opacity = 0.7,
  className = "",
}: NebulaLiquidChromeProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const { qualityLevel } = useQualitySettingsStore();

  const qualityMultiplier =
    qualityLevel === "low" ? 0.3 : qualityLevel === "high" ? 0.8 : 0.5;
  const adjustedSpeed = speed * qualityMultiplier;
  const adjustedAmplitude = amplitude * qualityMultiplier;

  const hexToRgb = (hex: string): [number, number, number] => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) {
      return [0.1, 0.1, 0.1];
    }

    const r = Number.parseInt(result[1], 16) / 255;
    const g = Number.parseInt(result[2], 16) / 255;
    const b = Number.parseInt(result[3], 16) / 255;

    return [r, g, b];
  };

  const baseColor = hexToRgb(accentColor.value);

  return (
    <div className={`absolute inset-0 ${className}`} style={{ opacity }}>
      <LiquidChrome
        baseColor={baseColor}
        speed={adjustedSpeed}
        amplitude={adjustedAmplitude}
        frequencyX={frequencyX}
        frequencyY={frequencyY}
        interactive={true}
      />
    </div>
  );
}
