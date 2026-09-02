"use client";

import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../lib/utils";
import { useThemeStore } from "../store/useThemeStore";
import { BACKGROUND_EFFECTS } from "../store/background-effect-store";
import { useQualitySettingsStore } from "../store/quality-settings-store";
import { MatrixRainEffect } from "./effects/MatrixRainEffect";
import { EnchantmentParticlesEffect } from "./effects/EnchantmentParticlesEffect";
import { NebulaWaves } from "./effects/NebulaWaves";
import { NebulaParticles } from "./effects/NebulaParticles";
import { NebulaGrid } from "./effects/NebulaGrid";
import { NebulaVoxels } from "./effects/NebulaVoxels";
import { NebulaLightning } from "./effects/NebulaLightning";
import { NebulaLiquidChrome } from "./effects/NebulaLiquidChrome";

interface EffectPreviewCardProps {
  effectId: string;
  name: string;
  icon: string;
  onClick: () => void;
  isActive: boolean;
}

export default function EffectPreviewCard({
  effectId,
  name,
  icon,
  onClick,
  isActive,
}: EffectPreviewCardProps) {
  const { accentColor } = useThemeStore();
  const [isHovered, setIsHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const { qualityLevel } = useQualitySettingsStore();

  const getQualityParams = () => {
    switch (qualityLevel) {
      case "low":
        return { particleCount: 30, opacity: 0.3, speed: 0.5 };
      case "high":
        return { particleCount: 80, opacity: 0.4, speed: 1.5 };
      default: // medium
        return { particleCount: 50, opacity: 0.3, speed: 1 };
    }
  };

  const qualityParams = getQualityParams();

  const renderEffect = () => {
    const previewProps = {
      ...qualityParams,
      className: "pointer-events-none",
      forceEnable: true,
    };

    switch (effectId) {
      case BACKGROUND_EFFECTS.MATRIX_RAIN:
        return <MatrixRainEffect {...previewProps} />;
      case BACKGROUND_EFFECTS.ENCHANTMENT_PARTICLES:
        return (
          <EnchantmentParticlesEffect
            particleCount={qualityParams.particleCount}
            interactive={false}
            {...previewProps}
          />
        );
      case BACKGROUND_EFFECTS.NEBULA_WAVES:
        return <NebulaWaves {...previewProps} />;
      case BACKGROUND_EFFECTS.NEBULA_PARTICLES:
        return (
          <NebulaParticles
            particleCount={qualityParams.particleCount}
            {...previewProps}
          />
        );
      case BACKGROUND_EFFECTS.NEBULA_GRID:
        return <NebulaGrid gridSize={20} {...previewProps} />;
      case BACKGROUND_EFFECTS.NEBULA_VOXELS:
        return (
          <NebulaVoxels
            cubeCount={qualityParams.particleCount / 2}
            {...previewProps}
          />
        );
      case BACKGROUND_EFFECTS.NEBULA_LIGHTNING:
        return (
          <NebulaLightning
            speed={qualityParams.speed}
            intensity={0.8}
            {...previewProps}
          />
        );
      case BACKGROUND_EFFECTS.NEBULA_LIQUID_CHROME:
        return (
          <NebulaLiquidChrome
            speed={qualityParams.speed * 0.15}
            {...previewProps}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      ref={cardRef}
      className={cn(
        "relative overflow-hidden transition-all duration-300 p-3 rounded-md h-40",
        "border border-b-2 cursor-pointer",
        "bg-black/20 backdrop-blur-md",
        isActive ? "ring-2 ring-white/30" : "hover:bg-black/40",
      )}
      style={{
        borderColor: isActive
          ? `${accentColor.value}80`
          : `${accentColor.value}40`,
        borderBottomColor: isActive
          ? accentColor.value
          : `${accentColor.value}60`,
        backgroundColor: isActive
          ? `${accentColor.value}20`
          : "rgba(0, 0, 0, 0.2)",
        filter: isHovered ? "brightness(1.1)" : "brightness(1)",
      }}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="absolute inset-0 overflow-hidden rounded-md">
        {renderEffect()}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
      </div>

      <div className="relative z-10 flex flex-col h-full">
        <div className="flex-grow flex items-center justify-center">
          <Icon
            icon={icon}
            className={cn(
              "w-12 h-12 text-white transition-transform duration-300",
              isHovered && "scale-110",
            )}
          />
        </div>

        <div className="mt-auto text-center">
          <h5 className="font-smallcaps text-sm text-white">
            {name}
          </h5>
        </div>
      </div>

      {isActive && (
        <div className="absolute top-2 right-2 z-10">
          <Icon
            icon="solar:check-circle-bold"
            className="w-5 h-5"
            style={{ color: accentColor.value }}
          />
        </div>
      )}
    </div>
  );
}
