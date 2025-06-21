"use client";

import type React from "react";
import { useEffect, useRef, useState, useCallback } from "react";
import { useThemeStore } from "../../store/useThemeStore";
import { cn } from "../../lib/utils";
import { Icon } from "@iconify/react";
import { 
  getBorderRadiusClass,
  getAccessibilityProps,
  type ComponentSize,
  type ComponentVariant 
} from "./design-system";

interface RangeSliderProps {
  value: number;
  onChange: (value: number) => void;
  onChangeEnd?: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  valueLabel?: string;
  minLabel?: string;
  maxLabel?: string;
  disabled?: boolean;
  showValue?: boolean;
  size?: ComponentSize;
  className?: string;
  variant?: ComponentVariant;
  icon?: React.ReactNode;
  label?: string;
  description?: string;
}

export function RangeSlider({
  value,
  onChange,
  onChangeEnd,
  min,
  max,
  step = 1,
  valueLabel,
  minLabel,
  maxLabel,
  disabled = false,
  showValue = true,
  size = "md",
  className,
  variant = "flat",
  icon,
  label,
  description,
}: RangeSliderProps) {
  const accentColor = useThemeStore((state) => state.accentColor);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const sliderRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const valueDisplayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastChangeTimeRef = useRef(0);
  
  const radiusClass = getBorderRadiusClass();
  const accessibilityProps = getAccessibilityProps({
    label,
    description,
    disabled,
    required: false
  });

  useEffect(() => {
    if (!isDragging) {
      setLocalValue(value);
    }
  }, [value, isDragging]);  const sizeConfig = {
    sm: {
      track: "h-2",
      thumb: "w-5 h-5",
      text: "text-xs",
    },
    md: {
      track: "h-3",
      thumb: "w-6 h-6",
      text: "text-base",
    },
    lg: {
      track: "h-4",
      thumb: "w-8 h-8",
      text: "text-lg",
    },
  };

  const getPercentage = useCallback((val: number) => {
    return ((val - min) / (max - min)) * 100;
  }, [min, max]);

  const updateVisualPosition = useCallback((newValue: number) => {
    if (!progressRef.current || !thumbRef.current) return;
    
    const percentage = getPercentage(newValue);
    progressRef.current.style.width = `${percentage}%`;
    thumbRef.current.style.left = `${percentage}%`;
    
    if (valueDisplayRef.current) {
      valueDisplayRef.current.textContent = String(newValue);
    }
  }, [getPercentage]);

  const calculateValueFromMouseEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
    if (!trackRef.current) return localValue;
    
    const rect = trackRef.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const width = rect.width;
    const percentage = Math.max(0, Math.min(1, offsetX / width));
    let newValue = min + percentage * (max - min);

    if (step > 0) {
      newValue = Math.round(newValue / step) * step;
    }

    return Math.max(min, Math.min(max, newValue));
  }, [min, max, step, localValue]);

  const handleMouseEnter = () => {
    if (disabled) return;
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    if (disabled) return;
    setIsHovered(false);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (disabled) return;
    
    setIsDragging(true);
    const newValue = calculateValueFromMouseEvent(e);
    
    setLocalValue(newValue);
    updateVisualPosition(newValue);
    
    const now = Date.now();
    if (now - lastChangeTimeRef.current > 16) {
      onChange(newValue);
      lastChangeTimeRef.current = now;
    }

    if (inputRef.current) {
      inputRef.current.focus();
    }
    e.preventDefault();
  };

  const handleMouseUp = useCallback(() => {
    if (!isDragging) return;
    
    setIsDragging(false);
    
    if (onChangeEnd) {
      onChangeEnd(localValue);
    }
  }, [isDragging, localValue, onChangeEnd]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = Number(e.target.value);
    setLocalValue(newValue);
    updateVisualPosition(newValue);
    onChange(newValue);
  };

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const newValue = calculateValueFromMouseEvent(e);
      setLocalValue(newValue);
      updateVisualPosition(newValue);
      
      const now = Date.now();
      if (now - lastChangeTimeRef.current > 16) {
        onChange(newValue);
        lastChangeTimeRef.current = now;
      }
    };

    const handleGlobalMouseUp = () => {
      if (isDragging) {
        handleMouseUp();
      }
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleGlobalMouseMove);
      document.addEventListener("mouseup", handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleGlobalMouseMove);
      document.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [isDragging, calculateValueFromMouseEvent, onChange, handleMouseUp]);

  return (
    <div
      ref={sliderRef}
      className={cn(
        "relative w-full",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      {valueLabel && (
        <div className="flex items-center gap-2 mb-2">
          {icon && <span className="text-white">{icon}</span>}
          <span
            className={cn(
              "text-white tracking-wide",
              sizeConfig[size].text,
            )}
          >
            {valueLabel}
          </span>
        </div>
      )}

      <div className="mb-2">
        {showValue && (
          <div className="flex justify-between mb-1">            {minLabel && (
              <span
                className={cn(
                  "text-white/70",
                  sizeConfig[size].text,
                )}
              >
                {minLabel}
              </span>
            )}<div className="flex items-center gap-1">
              <span                ref={valueDisplayRef}
                className={cn(
                  "text-white",
                  sizeConfig[size].text,
                )}
              >
                {localValue}
              </span>
              {localValue === max && (
                <Icon
                  icon="solar:star-bold"
                  className="w-3 h-3 text-yellow-400"
                />
              )}
            </div>            {maxLabel && (
              <span
                className={cn(
                  "text-white/70",
                  sizeConfig[size].text,
                )}
              >
                {maxLabel}
              </span>
            )}
          </div>
        )}

        <div
          className="relative pt-4 pb-4 cursor-pointer"
          onMouseDown={handleMouseDown}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >          <div
            className={cn(
              "relative overflow-hidden transition-colors duration-200",
              "border border-white/10",
              "focus-within:ring-1 focus-within:ring-white/30",
              radiusClass,
              sizeConfig[size].track,
            )}
            style={{
              backgroundColor: `${accentColor.value}15`,
              borderColor: `${accentColor.value}40`,
            }}
            ref={trackRef}
          >
            <div
              ref={progressRef}
              className={cn("absolute h-full", radiusClass)}
              style={{
                width: `${getPercentage(localValue)}%`,
                backgroundColor: `${accentColor.value}${isHovered ? "60" : "50"}`,
              }}
            />
          </div>

          <div
            ref={thumbRef}
            className={cn(
              "absolute top-2 -translate-x-1/2 z-10 cursor-grab",
              isDragging && "cursor-grabbing",
              "border-2",
              radiusClass,
              sizeConfig[size].thumb,
              "transition-colors duration-200",
            )}
            style={{
              backgroundColor: `${accentColor.value}${isHovered || isDragging ? "90" : "80"}`,
              borderColor: `${accentColor.value}`,
              left: `${getPercentage(localValue)}%`,
              transform: isDragging
                ? "translateX(0) scale(1.1)"
                : "translateX(0) scale(1)",
            }}
          >
            <div
              className={cn("absolute inset-0 bg-gradient-to-b from-white/20 to-transparent transition-opacity duration-200", radiusClass)}
              style={{ opacity: isHovered || isDragging ? 0.5 : 0 }}
            />

            <div className="absolute inset-0 flex items-center justify-center opacity-70">
              <div className="w-2/3 h-[2px] bg-white/50"></div>
            </div>
          </div>
        </div>
      </div>      <input
        ref={inputRef}
        type="range"
        min={min}
        max={max}
        step={step}
        value={localValue}
        onChange={handleChange}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        disabled={disabled}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={localValue}
        aria-valuetext={
          valueLabel ? `${valueLabel}: ${localValue}` : `${localValue}`
        }
        {...accessibilityProps}
      />
      {description && (
        <p 
          id={accessibilityProps["aria-describedby"]}
          className="text-sm text-gray-400 mt-1"
        >
          {description}
        </p>
      )}
    </div>
  );
}
