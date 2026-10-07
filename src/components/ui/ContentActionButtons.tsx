"use client";

import React from "react";
import { ActionButton, type ActionButtonVariant } from "./ActionButton";

export interface ContentActionButton {
  /** Unique identifier for the button */
  id: string;
  /** Label text to display (optional for icon-only buttons) */
  label?: string;
  /** Icon to display */
  icon: string;
  /** Button variant/style */
  variant: ActionButtonVariant;
  /** Optional tooltip text */
  tooltip?: string;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Whether the button is loading (shows spinner) */
  loading?: boolean;
  /** Click handler */
  onClick: (e: React.MouseEvent) => void;
}

export interface ContentActionButtonsProps {
  /** Array of action button configurations */
  actions: ContentActionButton[];
  /** Additional CSS classes */
  className?: string;
  /** Button size */
  size?: "sm" | "md" | "lg";
  /** Whether to use flex-grow spacer between buttons */
  useFlexSpacer?: boolean;
  /** Index after which to insert the flex spacer (only if useFlexSpacer is true) */
  flexSpacerAfterIndex?: number;
}

export function ContentActionButtons({
  actions,
  className = "",
  size = "md",
  useFlexSpacer = false,
  flexSpacerAfterIndex = 1,
}: ContentActionButtonsProps) {
  const handleButtonClick = (action: ContentActionButton, e: React.MouseEvent) => {
    if (!action.disabled && !action.loading) {
      action.onClick(e);
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {actions.map((action, index) => {
        const buttonElement = (
          <ActionButton
            key={action.id}
            id={action.id}
            label={action.label}
            icon={action.icon}
            variant={action.variant}
            tooltip={action.tooltip}
            disabled={action.disabled || action.loading}
            loading={action.loading}
            size={size}
            onClick={(e) => handleButtonClick(action, e)}
          />
        );

        // Insert flex spacer if needed
        if (useFlexSpacer && index === flexSpacerAfterIndex) {
          return (
            <React.Fragment key={`${action.id}-with-spacer`}>
              {buttonElement}
              <div className="flex-1"></div>
            </React.Fragment>
          );
        }

        return buttonElement;
      })}
    </div>
  );
}
