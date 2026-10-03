"use client";

import type { HTMLAttributes } from "react";

import { useThemeStore } from "../../store/useThemeStore";
import { cn } from "../../lib/utils";

function complementaryBackground(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  const rgb = m
    ? {
        r: Number.parseInt(m[1], 16),
        g: Number.parseInt(m[2], 16),
        b: Number.parseInt(m[3], 16),
      }
    : { r: 34, g: 34, b: 34 };
  const r = Math.min(Math.floor(rgb.r * 0.1), 30);
  const g = Math.min(Math.floor(rgb.g * 0.1), 30);
  const b = Math.min(Math.floor(rgb.b * 0.1), 30);
  return `rgb(${r}, ${g}, ${b})`;
}

function BorderGlow({ color }: { color: string }) {
  return (
    <>
      <div
        className="absolute top-0 left-0 right-0 h-[2px] pointer-events-none"
        style={{
          background: `linear-gradient(to right, transparent, ${color}70, transparent)`,
        }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 h-[2px] pointer-events-none"
        style={{
          background: `linear-gradient(to right, transparent, ${color}70, transparent)`,
        }}
      />
      <div
        className="absolute top-0 bottom-0 left-0 w-[2px] pointer-events-none"
        style={{
          background: `linear-gradient(to bottom, transparent, ${color}70, transparent)`,
        }}
      />
      <div
        className="absolute top-0 bottom-0 right-0 w-[2px] pointer-events-none"
        style={{
          background: `linear-gradient(to bottom, transparent, ${color}70, transparent)`,
        }}
      />
    </>
  );
}

export function WindowFrame({ className, style, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const accent = useThemeStore((state) => state.accentColor.value);
  const bgColor = complementaryBackground(accent);

  return (
    <div
      className={cn(
        "flex flex-col h-screen w-screen text-white overflow-hidden relative backdrop-blur-lg border-2",
        className,
      )}
      style={{
        backgroundColor: bgColor,
        backgroundImage: `linear-gradient(to bottom right, ${bgColor}, rgba(0,0,0,0.9))`,
        borderColor: `${accent}30`,
        boxShadow: `0 0 15px ${accent}30, inset 0 0 10px ${accent}20`,
        ...style,
      }}
      {...rest}
    >
      <BorderGlow color={accent} />
      {children}
    </div>
  );
}
