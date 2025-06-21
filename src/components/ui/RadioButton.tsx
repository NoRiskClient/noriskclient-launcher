"use client";

import type React from "react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { gsap } from "gsap";
import { useThemeStore } from "../../store/useThemeStore";
import { 
  getVariantColors, 
  getSizeClasses,
  getBorderRadiusClass,
  getAccessibilityProps,
  type ComponentSize,
  type ComponentVariant 
} from "./design-system";

interface RadioButtonProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  variant?: ComponentVariant;
  size?: ComponentSize;
  shadowDepth?: "default" | "short" | "none";
  icon?: React.ReactNode;
  description?: string;
  error?: string;
}

interface RippleType {
  x: number;
  y: number;
  size: number;
  id: number;
}

export const RadioButton = forwardRef<HTMLInputElement, RadioButtonProps>(
  (
    {
      label,
      className,
      variant = "default",
      size = "md",
      disabled = false,
      shadowDepth = "short",
      icon,
      checked,
      onChange,
      onClick,
      description,
      error,
      ...props
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLLabelElement>(null);
    const radioRef = useRef<HTMLInputElement>(null);
    const [ripples, setRipples] = useState<RippleType[]>([]);
    const rippleCounter = useRef(0);
    const accentColor = useThemeStore((state) => state.accentColor);
    const isBackgroundAnimationEnabled = useThemeStore((state) => state.isBackgroundAnimationEnabled);
    const [isPressed, setIsPressed] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [isChecked, setIsChecked] = useState(checked);

    useEffect(() => {
      setIsChecked(checked);
    }, [checked]);

    const mergedRef = (node: HTMLInputElement) => {
      if (ref) {
        if (typeof ref === "function") {
          ref(node);
        } else {
          ref.current = node;
        }
      }
      radioRef.current = node;
    };

    useEffect(() => {
      if (containerRef.current && isBackgroundAnimationEnabled) {
        gsap.fromTo(
          containerRef.current,
          { scale: 0.95, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.4, ease: "power2.out" },
        );
      }
    }, [isBackgroundAnimationEnabled]);

    const colors = getVariantColors(variant, accentColor);
    const sizeClasses = getSizeClasses(size);
    const radiusClass = getBorderRadiusClass();
    const accessibilityProps = getAccessibilityProps({
      label,
      description,
      error,
      required: props.required,
      disabled
    });    const handleRipple = (e: React.MouseEvent<HTMLLabelElement>) => {
      if (disabled) return;

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const size = Math.max(rect.width, rect.height) * 2.5;

      const newRipple: RippleType = {
        x,
        y,
        size,
        id: rippleCounter.current,
      };

      rippleCounter.current += 1;
      setRipples((prevRipples) => [...prevRipples, newRipple]);

      setTimeout(() => {
        setRipples((prevRipples) =>
          prevRipples.filter((ripple) => ripple.id !== newRipple.id),
        );
      }, 850);

      if (onClick) onClick(e as any);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setIsChecked(e.target.checked);
      if (onChange) onChange(e);
    };

    const handleMouseDown = () => {
      if (disabled) return;
      setIsPressed(true);

      if (containerRef.current && isBackgroundAnimationEnabled) {
        gsap.to(containerRef.current, {
          scale: 0.95,
          duration: 0.1,
          ease: "power2.out",
        });
      }
    };

    const handleMouseUp = () => {
      if (disabled) return;
      setIsPressed(false);

      if (containerRef.current && isBackgroundAnimationEnabled) {
        gsap.to(containerRef.current, {
          scale: 1,
          duration: 0.2,
          ease: "elastic.out(1.2, 0.4)",
        });
      }
    };

    const handleMouseEnter = () => {
      if (disabled) return;
      setIsHovered(true);

      if (containerRef.current && isBackgroundAnimationEnabled) {
        gsap.to(containerRef.current, {
          boxShadow:
            variant === "ghost" || shadowDepth === "none"
              ? "none"
              : `0 6px 0 rgba(0,0,0,0.25), 0 8px 12px rgba(0,0,0,0.4)`,
          duration: 0.2,
          ease: "power2.out",
        });
      }
    };

    const handleMouseLeave = () => {
      if (disabled) return;
      setIsHovered(false);

      if (containerRef.current && isBackgroundAnimationEnabled) {
        gsap.to(containerRef.current, {
          boxShadow:
            variant === "ghost" || shadowDepth === "none"
              ? "none"
              : `0 4px 0 rgba(0,0,0,0.3), 0 6px 10px rgba(0,0,0,0.35)`,
          duration: 0.2,
          ease: "power2.out",
        });
      }

      if (isPressed) {
        handleMouseUp();
      }
    };    const getRadioSizes = (): string => {
      switch (size) {
        case "xs": return "w-4 h-4";
        case "sm": return "w-5 h-5";
        case "md": return "w-6 h-6";
        case "lg": return "w-7 h-7";
        case "xl": return "w-8 h-8";
        default: return "w-6 h-6";
      }
    };

    const getBackgroundColor = () => {
      if (variant === "ghost") return "transparent";
      const baseOpacity = isHovered ? "50" : "30";
      return `${colors.main}${baseOpacity}`;
    };

    const getBorderColor = () => {
      if (variant === "ghost") return "transparent";
      return isHovered ? `${colors.main}90` : `${colors.main}80`;
    };

    const initialPart1Y = shadowDepth === "short" ? "4px" : "8px";
    const initialPart2Y = shadowDepth === "short" ? "6px" : "10px";
    const initialPart2Blur = shadowDepth === "short" ? "10px" : "15px";

    const initialBoxShadow =
      variant === "ghost" || shadowDepth === "none"
        ? "none"
        : `0 ${initialPart1Y} 0 rgba(0,0,0,0.3), 0 ${initialPart2Y} ${initialPart2Blur} rgba(0,0,0,0.35), inset 0 1px 0 ${colors.light}40, inset 0 0 0 1px ${colors.main}20`;

    return (
      <fieldset role="radiogroup">
        <label
          ref={containerRef}
          className={cn(
            "font-minecraft relative overflow-hidden backdrop-blur-md transition-all duration-200",
            radiusClass,
            "text-white tracking-wider lowercase",
            "flex items-center gap-3 cursor-pointer",
            "text-shadow-sm",
            variant !== "ghost" && shadowDepth !== "none" && "border-2 border-b-4",
            "focus-within:outline-none focus-within:ring-2 focus-within:ring-white/30 focus-within:ring-offset-1 focus-within:ring-offset-black/20",
            disabled && "opacity-50 cursor-not-allowed hover:translate-y-0",
            sizeClasses,
            className,
          )}
          style={{
            backgroundColor: getBackgroundColor(),
            borderColor: getBorderColor(),
            borderBottomColor:
              variant === "ghost" || shadowDepth === "none"
                ? "transparent"
                : isHovered
                  ? colors.light
                  : colors.dark,
            boxShadow: initialBoxShadow,
            color: colors.text,            transform: isHovered && !disabled && isBackgroundAnimationEnabled
              ? "translateY(-3px) scale(1.05)"
              : isHovered && !disabled 
                ? "scale(1.05)" 
                : "translateY(0) scale(1)",
            filter: isHovered && !disabled ? "brightness(1.1)" : "brightness(1)",
          }}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={handleRipple}
          {...accessibilityProps}
        >
          {variant !== "ghost" && (
            <span
              className="absolute inset-x-0 top-0 h-[2px] rounded-t-sm transition-colors duration-200"
              style={{
                backgroundColor: isHovered ? `${colors.light}` : `${colors.light}80`,
                opacity: isHovered ? 1 : 0.8,
              }}
            />
          )}

          {ripples.map((ripple) => (
            <span
              key={ripple.id}
              className="absolute rounded-full pointer-events-none bg-white/30 animate-ripple"
              style={{
                left: ripple.x - ripple.size / 2,
                top: ripple.y - ripple.size / 2,
                width: ripple.size,
                height: ripple.size,
              }}
            />
          ))}

          <div className="relative flex items-center justify-center">
            <input
              ref={mergedRef}
              type="radio"
              className="sr-only"
              disabled={disabled}
              checked={isChecked}
              onChange={handleChange}
              {...props}
            />
            <div
              className={cn(
                "relative flex items-center justify-center transition-all duration-200",
                radiusClass,
                getRadioSizes(),
              )}
              style={{
                backgroundColor: isChecked ? colors.main : "rgba(0,0,0,0.2)",
                borderWidth: "2px",
                borderStyle: "solid",
                borderColor: isChecked ? colors.light : "rgba(255,255,255,0.3)",
                boxShadow: isChecked
                  ? `0 0 8px ${colors.main}80, inset 0 0 4px ${colors.light}`
                  : "inset 0 1px 2px rgba(0,0,0,0.3)",
              }}
            >
              {isChecked && (
                <div
                  className={cn("absolute animate-pulse", radiusClass)}
                  style={{
                    width: "40%",
                    height: "40%",
                    backgroundColor: colors.text,
                    boxShadow: `0 0 6px ${colors.light}`,
                  }}
                />
              )}
            </div>
          </div>

          <span className="relative z-10 flex-grow">{label}</span>
          {icon && (
            <span className="flex items-center justify-center ml-auto" aria-hidden="true">
              {icon}
            </span>
          )}
        </label>
        {description && (
          <p 
            id={accessibilityProps["aria-describedby"]}
            className="text-sm text-gray-400 mt-1 ml-2"
          >
            {description}
          </p>
        )}
        {error && (
          <p 
            id={accessibilityProps["aria-describedby"]}
            className="text-sm text-red-400 mt-1 ml-2"
            role="alert"
          >
            {error}
          </p>
        )}
      </fieldset>
    );
  },
);

RadioButton.displayName = "RadioButton";
