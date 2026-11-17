import React from "react";
import type { Profile } from "../../types/profile";
import { ActionButton, type ActionButtonVariant } from "./ActionButton";

export interface ProfileActionButton {
  /** Unique identifier for the button */
  id: string;
  /** Label text to display */
  label: string;
  /** Icon to display */
  icon: string;
  /** Button variant/style */
  variant: ActionButtonVariant;
  /** Optional tooltip text */
  tooltip?: string;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Click handler */
  onClick: (profile: Profile, e: React.MouseEvent) => void;
}

export interface ProfileActionButtonsProps {
  /** The profile these actions are for */
  profile: Profile;
  /** Array of action button configurations */
  actions: ProfileActionButton[];
  /** Additional CSS classes */
  className?: string;
  /** Button size */
  size?: "sm" | "md" | "lg";
  /** Whether to use flex-grow spacer between buttons */
  useFlexSpacer?: boolean;
  /** Index after which to insert the flex spacer (only if useFlexSpacer is true) */
  flexSpacerAfterIndex?: number;
}

export function ProfileActionButtons({
  profile,
  actions,
  className = "",
  size = "md",
  useFlexSpacer = false,
  flexSpacerAfterIndex = 1,
}: ProfileActionButtonsProps) {
  const handleButtonClick = (action: ProfileActionButton, e: React.MouseEvent) => {
    if (!action.disabled) {
      action.onClick(profile, e);
    }
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {actions.map((action, index) => {
        const buttonElement = (
          <ActionButton
            key={action.id}
            id={action.id}
            label={action.label}
            icon={action.icon}
            variant={action.variant}
            tooltip={action.tooltip}
            disabled={action.disabled}
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
