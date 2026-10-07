"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type AriaAttributes } from "react";
import { useThemeStore } from "../../store/useThemeStore";
import { cn } from "../../lib/utils";
import { useAnimationsEnabled, useEntranceAnimation } from "../../hooks/useEntranceAnimation";
import { gsap } from "gsap";
import { useSettingControl } from "./settings/SettingControlContext";

interface ToggleSwitchProps extends AriaAttributes {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled = false,
  size = "md",
  className,
  ...ariaProps
}: ToggleSwitchProps) {
  const labelId = useId();
  const row = useSettingControl();
  const accentColor = useThemeStore((state) => state.accentColor);
  const animationsEnabled = useAnimationsEnabled();
  const [isHovered, setIsHovered] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLLabelElement>(null);

  const getSizeConfig = () => {
    switch (size) {
      case "sm":
        return {
          track: "w-8 h-4",
          knob: "w-3 h-3",
          knobTranslate: "translate-x-4",
          label: "text-xs",
        };
      case "lg":
        return {
          track: "w-14 h-7",
          knob: "w-5 h-5",
          knobTranslate: "translate-x-7",
          label: "text-base",
        };
      default:
        return {
          track: "w-10 h-5",
          knob: "w-4 h-4",
          knobTranslate: "translate-x-5",
          label: "text-sm",
        };
    }
  };

  const sizeConfig = getSizeConfig();

  useEntranceAnimation(
    containerRef,
    { opacity: 0, scale: 0.95 },
    { opacity: 1, scale: 1, duration: 0.4, ease: "power2.out" },
  );

  useLayoutEffect(() => {
    const context = gsap.context(() => {
    if (knobRef.current) {
      gsap.to(knobRef.current, {
        x: checked ? (size === "sm" ? 16 : size === "lg" ? 28 : 20) : 0,
        backgroundColor: checked ? "#ffffff" : "#f0f0f0",
        boxShadow: checked
          ? `0 1px 3px rgba(0,0,0,0.3), 0 0 0 2px ${accentColor.value}40`
          : "0 1px 3px rgba(0,0,0,0.3)",
        duration: animationsEnabled ? 0.3 : 0,
        ease: "power2.inOut",
      });
    }

    if (trackRef.current) {
      gsap.to(trackRef.current, {
        backgroundColor: checked
          ? `${accentColor.value}80`
          : `${accentColor.value}30`,
        borderColor: checked
          ? `${accentColor.value}CC`
          : `${accentColor.value}50`,
        duration: animationsEnabled ? 0.3 : 0,
        ease: "power2.inOut",
      });
    }
    });
    return () => context.revert();
  }, [checked, accentColor.value, size, animationsEnabled]);

  useEffect(() => {
    if (!animationsEnabled && knobRef.current) {
      gsap.killTweensOf(knobRef.current, "scale");
      gsap.set(knobRef.current, { scale: 1 });
    }
    return () => { if (knobRef.current) gsap.killTweensOf(knobRef.current, "scale"); };
  }, [animationsEnabled]);

  const handleMouseEnter = () => {
    if (disabled) return;
    setIsHovered(true);

    if (animationsEnabled && knobRef.current) {
      gsap.to(knobRef.current, {
        scale: 1.15,
        duration: 0.2,
        ease: "power2.out",
      });
    }
  };

  const handleMouseLeave = () => {
    if (disabled) return;
    setIsHovered(false);

    if (animationsEnabled && knobRef.current) {
      gsap.to(knobRef.current, {
        scale: 1,
        duration: 0.2,
        ease: "power2.out",
      });
    }
  };

  const handleClick = () => {
    if (disabled || !animationsEnabled) return;

    if (knobRef.current) {
      gsap.to(knobRef.current, {
        scale: 0.85,
        duration: 0.1,
        ease: "power2.out",
        onComplete: () => {
          gsap.to(knobRef.current, {
            scale: isHovered ? 1.15 : 1,
            duration: 0.2,
            ease: "elastic.out(1.2, 0.4)",
          });
        },
      });
    }
  };

  return (
    <label
      ref={containerRef}
      className={cn(
        "relative flex items-center gap-3 group",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        className,
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="relative" onClick={handleClick}>
        <div
          ref={trackRef}
          className={cn(
            "rounded-full group-focus-within:[outline-style:solid] group-focus-within:outline-2 group-focus-within:outline-white/80 group-focus-within:outline-offset-2",
            animationsEnabled && "transition-colors duration-200",
            sizeConfig.track,
          )}
          style={{
            backgroundColor: checked
              ? `${accentColor.value}80`
              : `${accentColor.value}30`,
            borderWidth: "2px",
            borderStyle: "solid",
            borderColor: checked
              ? `${accentColor.value}CC`
              : `${accentColor.value}50`,
            borderBottomWidth: "3px",
            borderBottomColor: checked
              ? accentColor.dark
              : `${accentColor.value}70`,
            boxShadow: `inset 0 1px 0 ${accentColor.value}20`,
          }}
        >
          <div
            ref={knobRef}
            className={cn(
              "absolute top-1/2 left-0.5 -translate-y-1/2 bg-white rounded-full shadow-md",
              sizeConfig.knob,
            )}
            style={{
              boxShadow: checked
                ? `0 1px 3px rgba(0,0,0,0.3), 0 0 0 2px ${accentColor.value}40`
                : "0 1px 3px rgba(0,0,0,0.3)",
              transform: `translate(${checked ? (size === "sm" ? 16 : size === "lg" ? 28 : 20) : 0}px, -50%) scale(${isHovered && animationsEnabled ? 1.15 : 1})`,
            }}
          />
        </div>
      </div>

      {label && (
        <span
          id={labelId}
          className={cn(
            "font-smallcaps text-white",
            sizeConfig.label,
          )}
        >
          {label}
        </span>
      )}

      <input
        type="checkbox"
        role="switch"
        className="sr-only absolute left-0 top-1/2"
        checked={checked}
        onChange={event => !disabled && onChange(event.currentTarget.checked)}
        disabled={disabled}
        aria-labelledby={label ? labelId : row.labelId}
        aria-describedby={row.descriptionId}
        {...ariaProps}
      />
    </label>
  );
}
