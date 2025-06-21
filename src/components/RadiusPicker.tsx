import { Icon } from "@iconify/react";
import { useThemeStore, DEFAULT_BORDER_RADIUS, MIN_BORDER_RADIUS, MAX_BORDER_RADIUS } from "../store/useThemeStore";
import { RangeSlider } from "./ui/RangeSlider";
import { cn } from "../lib/utils";

interface RadiusPickerProps {
  className?: string;
}

export const RadiusPicker = ({ className }: RadiusPickerProps) => {
  const { borderRadius, setBorderRadius } = useThemeStore();

  const handleSliderChange = (value: number) => {
    setBorderRadius(value);
  };

  const getRadiusLabel = (radius: number): string => {
    if (radius === 0) return "Square";
    if (radius <= 4) return "Minimal";
    if (radius <= 8) return "Small";
    if (radius <= 12) return "Medium";
    if (radius <= 16) return "Large";
    if (radius <= 24) return "Extra Large";
    return "Maximum";
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon icon="solar:widget-bold" className="w-5 h-5 text-white" />
          <h3 className="text-lg font-minecraft text-white lowercase">Border Radius</h3>
        </div>
        <span className="text-sm text-white/60 font-minecraft-ten">
          {borderRadius}px ({getRadiusLabel(borderRadius)})
        </span>
      </div>

      <RangeSlider
        value={borderRadius}
        onChange={handleSliderChange}
        min={MIN_BORDER_RADIUS}
        max={MAX_BORDER_RADIUS}
        step={1}
        size="md"
        variant="flat"
        icon={<Icon icon="solar:widget-bold" className="w-4 h-4" />}
        minLabel="Square"
        maxLabel="Round"
        showValue={false}
      />
      
      <div className="flex justify-between text-xs text-white/60 font-minecraft-ten">
        <span className={cn(
          "transition-colors duration-200",
          borderRadius === 0 ? "text-white" : "text-white/40"
        )}>
          0px
        </span>
        <span className={cn(
          "transition-colors duration-200",
          borderRadius === 8 ? "text-white" : "text-white/40"
        )}>
          8px
        </span>
        <span className={cn(
          "transition-colors duration-200",
          borderRadius === 16 ? "text-white" : "text-white/40"
        )}>
          16px
        </span>
        <span className={cn(
          "transition-colors duration-200",
          borderRadius === 24 ? "text-white" : "text-white/40"
        )}>
          24px
        </span>
        <span className={cn(
          "transition-colors duration-200",
          borderRadius === 32 ? "text-white" : "text-white/40"
        )}>
          32px
        </span>
      </div>
    </div>
  );
};
