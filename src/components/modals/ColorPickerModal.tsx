"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Icon } from "@iconify/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { useThemeStore } from "../../store/useThemeStore";
import { toast } from "react-hot-toast";

interface ColorPickerModalProps {
  onClose: () => void;
  onColorSelected?: (color: string) => void;
}

// HSV to RGB conversion
function hsvToRgb(h: number, s: number, v: number) {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;

  let r = 0, g = 0, b = 0;

  if (0 <= h && h < 60) {
    r = c; g = x; b = 0;
  } else if (60 <= h && h < 120) {
    r = x; g = c; b = 0;
  } else if (120 <= h && h < 180) {
    r = 0; g = c; b = x;
  } else if (180 <= h && h < 240) {
    r = 0; g = x; b = c;
  } else if (240 <= h && h < 300) {
    r = x; g = 0; b = c;
  } else if (300 <= h && h < 360) {
    r = c; g = 0; b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
}

// RGB to HSV conversion
function rgbToHsv(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;

  let h = 0;
  const s = max === 0 ? 0 : diff / max;
  const v = max;

  if (diff !== 0) {
    switch (max) {
      case r: h = ((g - b) / diff + (g < b ? 6 : 0)) * 60; break;
      case g: h = ((b - r) / diff + 2) * 60; break;
      case b: h = ((r - g) / diff + 4) * 60; break;
    }
  }

  return { h, s, v };
}

// Convert RGB to Hex
function rgbToHex(r: number, g: number, b: number) {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

// Parse hex color to RGB
function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

export function ColorPickerModal({ onClose, onColorSelected }: ColorPickerModalProps) {
  const { accentColor, setCustomAccentColor } = useThemeStore();
  const [hsv, setHsv] = useState(() => {
    const rgb = hexToRgb(accentColor.value);
    return rgbToHsv(rgb.r, rgb.g, rgb.b);
  });
  const [hex, setHex] = useState(accentColor.value);
  const [isDraggingSaturation, setIsDraggingSaturation] = useState(false);
  const [isDraggingHue, setIsDraggingHue] = useState(false);

  const saturationRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  // Update HSV when accent color changes
  useEffect(() => {
    const rgb = hexToRgb(accentColor.value);
    setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b));
    setHex(accentColor.value);
  }, [accentColor.value]);

  // Update hex when HSV changes
  useEffect(() => {
    const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
    const newHex = rgbToHex(rgb.r, rgb.g, rgb.b);
    setHex(newHex);
  }, [hsv]);

  // Handle mouse events for dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSaturation && saturationRef.current) {
        const rect = saturationRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        setHsv(prev => ({ ...prev, s: x, v: 1 - y }));
      } else if (isDraggingHue && hueRef.current) {
        const rect = hueRef.current.getBoundingClientRect();
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        const hue = y * 359.99; // Keep hue between 0-359.99 to avoid wrapping issues
        setHsv(prev => ({ ...prev, h: hue }));
      }
    };

    const handleMouseUp = () => {
      setIsDraggingSaturation(false);
      setIsDraggingHue(false);
    };

    if (isDraggingSaturation || isDraggingHue) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingSaturation, isDraggingHue]);


  const handleHexChange = useCallback((value: string) => {
    setHex(value);
    if (/^#[0-9A-F]{6}$/i.test(value)) {
      const rgb = hexToRgb(value);
      setHsv(rgbToHsv(rgb.r, rgb.g, rgb.b));
    }
  }, []);

  const handleApply = () => {
    if (/^#[0-9A-F]{6}$/i.test(hex)) {
      setCustomAccentColor(hex);
      onColorSelected?.(hex);
      toast.success("Color applied!");
      onClose();
    } else {
      toast.error("Please enter a valid hex color");
    }
  };

  const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);

  return (
    <Modal
      title="Color Picker"
      onClose={onClose}
      width="lg"
    >
      <div className="p-6 space-y-6">
        {/* Color Picker Interface */}
        <div className="flex gap-6">
          {/* Saturation/Value Picker */}
          <div className="flex-1">
            <div
              ref={saturationRef}
              className="relative w-full h-48 rounded-lg cursor-crosshair border border-white/20"
              style={{
                background: `hsl(${hsv.h}, 100%, 50%)`
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                setIsDraggingSaturation(true);
                if (saturationRef.current) {
                  const rect = saturationRef.current.getBoundingClientRect();
                  const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                  setHsv(prev => ({ ...prev, s: x, v: 1 - y }));
                }
              }}
            >
              {/* Saturation gradient overlay */}
              <div
                className="absolute inset-0 rounded-lg"
                style={{
                  background:
                      "linear-gradient(to top, rgb(0, 0, 0), rgba(0, 0, 0, 0)), " +
                      "linear-gradient(to right, rgb(255, 255, 255), rgba(255, 255, 255, 0))"
                }}
              />
              {/* Color indicator */}
              <div
                className="absolute w-4 h-4 border-2 border-white rounded-full shadow-lg transform -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: `${hsv.s * 100}%`,
                  top: `${(1 - hsv.v) * 100}%`,
                  backgroundColor: hex
                }}
              />
            </div>
          </div>

          {/* Hue Slider */}
          <div className="w-8">
            <div
              ref={hueRef}
              className="relative h-48 rounded-lg cursor-pointer border border-white/20"
              style={{
                background: 'linear-gradient(to bottom, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)'
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                setIsDraggingHue(true);
                if (hueRef.current) {
                  const rect = hueRef.current.getBoundingClientRect();
                  const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                  const hue = y * 359.99; // Keep hue between 0-359.99 to avoid wrapping issues
                  setHsv(prev => ({ ...prev, h: hue }));
                }
              }}
            >
              {/* Hue indicator */}
              <div
                className="absolute left-0 w-full h-1 bg-white border border-black transform -translate-y-1/2"
                style={{
                  top: `${(hsv.h / 359.99) * 100}%`
                }}
              />
            </div>
          </div>
        </div>

        {/* Color Values */}
        <div className="grid grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-minecraft-ten text-white/70 mb-1">Hex</label>
            <input
              type="text"
              value={hex}
              onChange={(e) => handleHexChange(e.target.value)}
              className="w-full px-3 py-2 bg-black/40 border border-white/20 rounded-md text-white font-minecraft-ten focus:outline-none focus:ring-2 focus:ring-white/30"
              placeholder="#000000"
            />
          </div>
          <div>
            <label className="block text-sm font-minecraft-ten text-white/70 mb-1">R</label>
            <input
              type="number"
              value={rgb.r}
              onChange={(e) => {
                const newRgb = { ...rgb, r: parseInt(e.target.value) || 0 };
                setHsv(rgbToHsv(newRgb.r, newRgb.g, newRgb.b));
              }}
              className="w-full px-3 py-2 bg-black/40 border border-white/20 rounded-md text-white font-minecraft-ten focus:outline-none focus:ring-2 focus:ring-white/30"
              min="0"
              max="255"
            />
          </div>
          <div>
            <label className="block text-sm font-minecraft-ten text-white/70 mb-1">G</label>
            <input
              type="number"
              value={rgb.g}
              onChange={(e) => {
                const newRgb = { ...rgb, g: parseInt(e.target.value) || 0 };
                setHsv(rgbToHsv(newRgb.r, newRgb.g, newRgb.b));
              }}
              className="w-full px-3 py-2 bg-black/40 border border-white/20 rounded-md text-white font-minecraft-ten focus:outline-none focus:ring-2 focus:ring-white/30"
              min="0"
              max="255"
            />
          </div>
          <div>
            <label className="block text-sm font-minecraft-ten text-white/70 mb-1">B</label>
            <input
              type="number"
              value={rgb.b}
              onChange={(e) => {
                const newRgb = { ...rgb, b: parseInt(e.target.value) || 0 };
                setHsv(rgbToHsv(newRgb.r, newRgb.g, newRgb.b));
              }}
              className="w-full px-3 py-2 bg-black/40 border border-white/20 rounded-md text-white font-minecraft-ten focus:outline-none focus:ring-2 focus:ring-white/30"
              min="0"
              max="255"
            />
          </div>
        </div>

        {/* Current Color Display */}
        <div className="flex items-center justify-between p-4 rounded-lg border border-[#ffffff20] bg-black/20">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-lg border-2 border-white/20 shadow-lg"
              style={{ backgroundColor: hex }}
            />
            <div>
              <h5 className="font-minecraft text-lg text-white">
                Selected Color
              </h5>
              <p className="text-sm text-white/70 font-minecraft-ten">
                {hex}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={onClose}
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              onClick={handleApply}
              variant="3d"
              icon={<Icon icon="solar:check-circle-bold" />}
            >
              Apply
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
