"use client";

import { useState } from "react";
import { Icon } from "@iconify/react";
import { ACCENT_COLORS, useThemeStore } from "../store/useThemeStore";
import { Button } from "./ui/buttons/Button";
import { Input } from "./ui/Input";

interface ColorPickerProps {
  shape?: "square" | "circle";
  size?: "sm" | "md" | "lg";
  showCustomOption?: boolean;
}

export function ColorPicker({
  shape = "square",
  size = "md",
  showCustomOption = true,
}: ColorPickerProps) {
  const { accentColor, setAccentColor, setCustomAccentColor, customColorHistory } = useThemeStore();
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [customColor, setCustomColor] = useState("#4f8eff");

  const sizeClasses = {
    sm: "w-8 h-8",
    md: "w-12 h-12",
    lg: "w-16 h-16",
  };

  const shapeClasses = {
    square: "rounded-md",
    circle: "rounded-full",
  };  const handleCustomColorSubmit = () => {
    const isValidHex = /^#[0-9A-F]{6}$/i.test(customColor);

    if (isValidHex) {
      setCustomAccentColor(customColor);
      setShowCustomPicker(false);
    } else {
      const input = document.querySelector('input[placeholder="#RRGGBB"]') as HTMLInputElement;
      if (input) {
        input.style.borderColor = '#ef4444';
        input.style.animation = 'shake 0.5s ease-in-out';
        setTimeout(() => {
          input.style.borderColor = '';
          input.style.animation = '';
        }, 500);
      }
    }
  };
  const handleCustomColorChange = (value: string) => {
    setCustomColor(value);
    const input = document.querySelector('input[placeholder="#RRGGBB"]') as HTMLInputElement;
    if (input) {
      input.style.borderColor = '';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {Object.values(ACCENT_COLORS).map((color) => (
          <button
            key={color.name}
            onClick={() => setAccentColor(color)}
            className={`
              ${sizeClasses[size]} 
              ${shapeClasses[shape]} 
              relative cursor-pointer transition-all duration-200
              shadow-[0_4px_0_rgba(0,0,0,0.2),0_6px_10px_rgba(0,0,0,0.3),inset_0_1px_1px_rgba(255,255,255,0.3)]
              hover:shadow-[0_5px_0_rgba(0,0,0,0.15),0_8px_15px_rgba(0,0,0,0.25),inset_0_1px_1px_rgba(255,255,255,0.4)]
              hover:translate-y-[-2px]
              active:shadow-[0_2px_0_rgba(0,0,0,0.1),0_3px_5px_rgba(0,0,0,0.2),inset_0_1px_1px_rgba(255,255,255,0.2)]
              active:translate-y-[1px]
              ${accentColor.value === color.value ? "ring-2 ring-white ring-offset-2 ring-offset-black/50" : ""}
            `}
            style={{ backgroundColor: color.value }}
            aria-label={`Set accent color to ${color.name}`}
          >
            {accentColor.value === color.value && (
              <span className="absolute inset-0 flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-6 h-6 drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]"
                >
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </span>
            )}
          </button>
        ))}

        {showCustomOption && (
          <button
            onClick={() => setShowCustomPicker(!showCustomPicker)}
            className={`
              ${sizeClasses[size]} 
              ${shapeClasses[shape]} 
              relative cursor-pointer transition-all duration-200
              shadow-[0_4px_0_rgba(0,0,0,0.2),0_6px_10px_rgba(0,0,0,0.3),inset_0_1px_1px_rgba(255,255,255,0.3)]
              hover:shadow-[0_5px_0_rgba(0,0,0,0.15),0_8px_15px_rgba(0,0,0,0.25),inset_0_1px_1px_rgba(255,255,255,0.4)]
              hover:translate-y-[-2px]
              active:shadow-[0_2px_0_rgba(0,0,0,0.1),0_3px_5px_rgba(0,0,0,0.2),inset_0_1px_1px_rgba(255,255,255,0.2)]
              active:translate-y-[1px]
              bg-gradient-to-r from-purple-500 via-pink-500 to-red-500
              ${accentColor.isCustom ? "ring-2 ring-white ring-offset-2 ring-offset-black/50" : ""}
            `}
            aria-label="Custom color"
          >
            <span className="absolute inset-0 flex items-center justify-center">
              <Icon
                icon="solar:palette-bold"
                className="w-6 h-6 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]"
              />
            </span>
          </button>
        )}
      </div>

      {showCustomPicker && (
        <div className="mt-4 p-4 bg-black/30 rounded-lg border border-white/10">
          <h5 className="font-minecraft text-xl lowercase text-white/80 mb-3">
            Custom Color
          </h5>          <div className="flex items-center gap-3">
            <div className="flex-1">              <Input
                type="text"
                value={customColor}
                onChange={(e) => handleCustomColorChange(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleCustomColorSubmit();
                  }
                }}
                placeholder="#RRGGBB"
                icon={<Icon icon="solar:palette-bold" />}
              />
            </div>            <div
              className={`w-10 h-10 rounded-md border-2 transition-all duration-200 cursor-pointer hover:scale-110 ${
                /^#[0-9A-F]{6}$/i.test(customColor) 
                  ? 'border-white/40 shadow-lg' 
                  : 'border-red-400/60 animate-pulse'
              }`}
              style={{ backgroundColor: customColor }}
              onClick={() => {
                if (/^#[0-9A-F]{6}$/i.test(customColor)) {
                  handleCustomColorSubmit();
                }
              }}
              title={/^#[0-9A-F]{6}$/i.test(customColor) ? `Click to apply ${customColor}` : 'Invalid color format - use 6-digit hex (e.g., #FF5733)'}
            />
            <Button
              onClick={handleCustomColorSubmit}
              size="sm"
              icon={<Icon icon="solar:check-circle-bold" />}
            >
              Apply
            </Button>
          </div>

          {customColorHistory.length > 0 && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <h6 className="font-minecraft text-lg lowercase text-white/70 mb-2">
                Recent Colors
              </h6>
              <div className="flex flex-wrap gap-2">
                {customColorHistory.map((historyColor, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      setCustomColor(historyColor);
                      setCustomAccentColor(historyColor);
                    }}
                    className={`
                      ${sizeClasses.sm} 
                      ${shapeClasses[shape]} 
                      relative cursor-pointer transition-all duration-200
                      shadow-[0_2px_0_rgba(0,0,0,0.2),0_3px_5px_rgba(0,0,0,0.3)]
                      hover:shadow-[0_3px_0_rgba(0,0,0,0.15),0_4px_8px_rgba(0,0,0,0.25)]
                      hover:translate-y-[-1px]
                      active:shadow-[0_1px_0_rgba(0,0,0,0.1),0_2px_3px_rgba(0,0,0,0.2)]
                      active:translate-y-[1px]
                      ${accentColor.value === historyColor ? "ring-1 ring-white ring-offset-1 ring-offset-black/50" : ""}
                    `}
                    style={{ backgroundColor: historyColor }}
                    aria-label={`Apply color ${historyColor}`}
                    title={historyColor}
                  >
                    {accentColor.value === historyColor && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="white"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="w-4 h-4 drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]"
                        >
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
