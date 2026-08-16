"use client";

import type React from "react";
import { useEffect, useState } from "react";
import type { Profile } from "../../types/profile";
import { ProfileIcon } from "./ProfileIcon";
import { useThemeStore } from "../../store/useThemeStore";

interface ProfileIconV2Props {
  profile: Profile;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function ProfileIconV2({
  profile,
  size = "md",
  className = "",
}: ProfileIconV2Props) {
  const accentColor = useThemeStore((state) => state.accentColor);

  const sizeClasses = {
    sm: "w-12 h-12",
    md: "w-16 h-16", 
    lg: "w-20 h-20",
  };

  const iconSizes = {
    sm: "w-6 h-6",
    md: "w-8 h-8",
    lg: "w-10 h-10",
  };

  return (
    <div
      className={`${sizeClasses[size]} rounded-lg border-2 flex items-center justify-center overflow-hidden ${className}`}
      style={{
        backgroundColor: `${accentColor.value}20`,
        borderColor: `${accentColor.borderValue || accentColor.textValue || accentColor.value}60`,
      }}
    >
      <ProfileIcon
        profileId={profile.id}
        banner={profile.banner}
        profileName={profile.name}
        accentColor={accentColor.value}
        onSuccessfulUpdate={() => {}}
        isEditable={false}
        variant="bare"
        className="w-full h-full"
        placeholderIcon="ph:package-duotone"
        iconClassName={iconSizes[size]}
      />
    </div>
  );
}
