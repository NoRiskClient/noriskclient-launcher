"use client";

import { useState, useRef, useEffect } from "react";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";

export interface DropdownOption {
  value: string;
  label: string;
  icon?: string;
  separator?: boolean;
}

interface CustomDropdownProps {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  className?: string;
  variant?: 'default' | 'search';
  size?: 'sm' | 'md';
}

export function CustomDropdown({
  label,
  value,
  options,
  onChange,
  className = "",
  variant = 'default',
  size = 'md',
}: CustomDropdownProps) {
  const isSm = size === 'sm';
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const accentColor = useThemeStore((state) => state.accentColor);

  const selectedOption = options.find(opt => opt.value === value) || options[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleOptionClick = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Label above (only if provided) */}
      {label && (
        <label className="block text-white font-minecraft text-3xl lowercase mb-2">
          {label}
        </label>
      )}

      {/* Dropdown Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 transition-all duration-200 focus:outline-none focus:ring-0 focus:border-transparent ${
          variant === 'search'
            ? `w-full justify-between bg-black/50 rounded-lg px-4 py-3 border border-white/10 hover:border-white/20 text-white font-minecraft-ten ${isSm ? 'text-sm' : 'text-xl'}`
            : label
            ? `w-full justify-between bg-transparent rounded-md px-2 py-1 border border-white/10 hover:border-white/20 bg-black/50 hover:bg-black/60 px-4 py-3 text-white font-minecraft-ten ${isSm ? 'text-sm' : 'text-xl'}`
            : `bg-transparent rounded-md px-2 py-1 text-white font-minecraft-ten ${isSm ? 'text-sm' : 'text-xl'}`
        }`}
        style={{
          boxShadow: isOpen ? `0 0 0 1px ${accentColor.value}40` : 'none',
          outline: 'none',
          border: label ? undefined : 'none',
        }}
        onMouseEnter={(e) => {
          if (!label) {
            e.currentTarget.style.backgroundColor = `${accentColor.value}15`;
          } else if (variant === 'search') {
            // Search variant hover effect - border color change
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
          }
        }}
        onMouseLeave={(e) => {
          if (!label) {
            e.currentTarget.style.backgroundColor = 'transparent';
          } else if (variant === 'search') {
            // Reset search variant border
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
          }
        }}
        title={selectedOption?.label}
      >
        <div className="flex items-center gap-2">
          {selectedOption?.icon && (
            <Icon icon={selectedOption.icon} className="w-4 h-4 text-white/70" />
          )}
          {label && <span>{selectedOption?.label}</span>}
        </div>
        {label && (
          <Icon 
            icon="solar:alt-arrow-down-bold" 
            className={`w-4 h-4 text-white/50 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className={`absolute top-full mt-2 bg-black/90 backdrop-blur-sm border border-white/20 rounded-lg shadow-xl z-50 overflow-hidden ${
          variant === 'search' ? 'left-0 right-0' : label ? 'left-0 right-0' : 'left-0 w-56'
        }`}>
          <div className="py-2">
            {options.map((option, index) => (
              <div key={option.value}>
                {option.separator && index > 0 && (
                  <div className={`border-t border-white/10 ${isSm ? 'my-1 mx-2' : 'my-1.5 mx-3'}`} />
                )}
                <button
                  onClick={() => handleOptionClick(option.value)}
                  className={`w-full flex items-center gap-2.5 text-left font-minecraft-ten transition-colors duration-150 ${
                    isSm ? 'px-2.5 py-1.5 text-xs' : 'px-4 py-3 text-base'
                  } ${
                    option.value === value
                      ? 'bg-white/10 text-white'
                      : 'text-white/80 hover:bg-white/5 hover:text-white'
                  }`}
                  style={{
                    backgroundColor: option.value === value ? `${accentColor.value}20` : undefined,
                  }}
                >
                  {option.icon && (
                    <Icon icon={option.icon} className="w-4 h-4 text-white/70 flex-shrink-0" />
                  )}
                  <span className="flex-1">{option.label}</span>
                  <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                    {option.value === value && (
                      <Icon
                        icon="solar:check-circle-bold"
                        className="w-4 h-4"
                        style={{ color: accentColor.value }}
                      />
                    )}
                  </div>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
