"use client";

import React from "react";
import { Icon } from "@iconify/react";

import { Tooltip } from "./Tooltip";

export interface ActionButton {
  /** Unique identifier for the button */
  id: string;
  /** Label text to display */
  label: string;
  /** Icon to display */
  icon: string;
  /** Optional tooltip text */
  tooltip?: string;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Click handler */
  onClick: () => void;
}

export interface ActionButtonsProps {
  /** Array of action button configurations */
  actions: ActionButton[];
  /** Additional CSS classes */
  className?: string;
  /** Refs for specific buttons by their id */
  buttonRefs?: Record<string, React.RefObject<HTMLButtonElement>>;
}

export function ActionButtons({
  actions,
  className = "",
  buttonRefs,
}: ActionButtonsProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {actions.map((action) => {
        const isIconOnly = !action.label || action.label.trim() === "";
        const button = (
          <button
            key={action.id}
            ref={buttonRefs?.[action.id]}
            onClick={action.onClick}
            className={`flex items-center ${isIconOnly ? 'justify-center w-8 h-8 p-[1em]' : 'gap-2 px-4 py-2'} bg-black/30 hover:bg-black/40 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded-lg font-smallcaps text-base transition-all duration-200`}
            disabled={action.disabled}
          >
            <div className="w-4 h-4 flex items-center justify-center">
              <Icon icon={action.icon} className="w-4 h-4" />
            </div>
            {!isIconOnly && (
              <span style={{ transform: 'translateY(-0.075em)' }}>{action.label}</span>
            )}
          </button>
        );

        if (!action.tooltip) return button;

        return (
          <Tooltip key={action.id} content={action.tooltip}>
            {button}
          </Tooltip>
        );
      })}
    </div>
  );
}
