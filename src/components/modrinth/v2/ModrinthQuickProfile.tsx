"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { SearchStyleInput } from "../../ui/Input";
import { IconButton } from "../../ui/buttons/IconButton";
import { Icon } from "@iconify/react";
import type { AccentColor } from "../../../store/useThemeStore";
import { cn } from "../../../lib/utils";
import { useProfileStore } from "../../../store/profile-store";

interface ModrinthQuickProfileProps {
  accentColor: AccentColor;
  projectTitle: string;
  versionNumber?: string;
  profileName: string;
  onProfileNameChange: (name: string) => void;
  error: string | null;
  isLoading?: boolean;

  selectedSourceProfileId: string | null;
  onSourceProfileChange: (profileId: string | null) => void;
}



export const ModrinthQuickProfile: React.FC<ModrinthQuickProfileProps> = ({
  accentColor,
  projectTitle,
  versionNumber,
  profileName,
  onProfileNameChange,
  error,
  isLoading = false,
  selectedSourceProfileId,
  onSourceProfileChange,
}) => {
  const { t } = useTranslation();
  const [showSourceSelectInput, setShowSourceSelectInput] = useState(false);
  const [profileSearchValue, setProfileSearchValue] = useState('');
  const [maxProfilesToShow, setMaxProfilesToShow] = useState(9);
  const { profiles: storeProfiles, loading: profilesLoading } =
    useProfileStore();



  const handleToggleCopySection = () => {
    if (selectedSourceProfileId) {
      onSourceProfileChange(null);
      setShowSourceSelectInput(false);
    } else {
      setShowSourceSelectInput(!showSourceSelectInput);
    }
  };

  const isActuallyCopying = selectedSourceProfileId !== null;

  // Filter profiles based on search
  const filteredProfiles = useMemo(() => {
    if (!profileSearchValue.trim()) return storeProfiles;
    const searchTerm = profileSearchValue.toLowerCase().trim();
    return storeProfiles.filter(profile =>
      profile.name.toLowerCase().includes(searchTerm) ||
      profile.game_version?.toLowerCase().includes(searchTerm) ||
      profile.loader?.toLowerCase().includes(searchTerm) ||
      profile.loader_version?.toLowerCase().includes(searchTerm)
    );
  }, [storeProfiles, profileSearchValue]);

  // Reset maxProfilesToShow when search changes
  useEffect(() => {
    setMaxProfilesToShow(9);
  }, [profileSearchValue]);

  const displayedProfiles = filteredProfiles.slice(0, maxProfilesToShow);

  const handleLoadMoreProfiles = () => {
    setMaxProfilesToShow(prev => prev + 9);
  };

  return (
    <div
      className={cn(
        "p-1 sm:p-2 md:p-4 space-y-4",
        isLoading && "opacity-70 pointer-events-none",
      )}
    >
      <div>
        <h3 className="text-xl sm:text-2xl font-semibold text-gray-100 font-minecraft-ten normal-case">
          {isActuallyCopying
            ? `Copy existing profile and install `
            : `Install `}
          <span style={{ color: accentColor.value }}>{projectTitle}</span>
          {versionNumber && (
            <span className="text-gray-400"> v{versionNumber}</span>
          )}
          {isActuallyCopying ? ` to new profile` : ` as new profile`}
        </h3>
      </div>

      <p className="text-xs font-minecraft-ten sm:text-sm text-gray-400">
        {isActuallyCopying
          ? `Copying settings from '${storeProfiles.find((p) => p.id === selectedSourceProfileId)?.name || "selected profile"}'. Enter a name for the new copy.`
          : "Enter a name for the new profile. Optionally, copy settings from an existing profile."}
      </p>

      <div className="flex items-start gap-2">
        <div className="flex-grow">
          <label
            htmlFor="quickProfileNameInput"
            className="block text-sm font-medium text-gray-300 mb-1 sr-only"
          >
            New Profile Name
          </label>
          <SearchStyleInput
            id="quickProfileNameInput"
            value={profileName}
            onChange={(e) => onProfileNameChange(e.target.value)}
            placeholder={t('placeholders.new_profile_name')}
            icon="solar:user-bold"
            error={error || undefined}
            disabled={isLoading}
          />
        </div>
        <IconButton
          icon={
            isActuallyCopying ? (
              <Icon
                icon="solar:close-circle-bold-duotone"
                className="w-5 h-5"
              />
            ) : (
              <Icon icon="solar:copy-bold-duotone" className="w-5 h-5" />
            )
          }
          onClick={handleToggleCopySection}
          variant="ghost"
          size="md"
          disabled={isLoading}
          title={
            isActuallyCopying
              ? "Clear source profile selection"
              : "Copy settings from existing profile"
          }
          className="flex-shrink-0 mt-0.5"
        />
      </div>


      {(showSourceSelectInput || isActuallyCopying) && (
        <div className="pt-2 animated-fade-in space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium font-minecraft-ten text-gray-400">
              Source Profile to Copy
            </label>
            <span className="text-xs text-white/50 font-minecraft-ten">
              {filteredProfiles.length} profile{filteredProfiles.length !== 1 ? 's' : ''}
            </span>
          </div>

          {profilesLoading ? (
            <div className="flex items-center justify-center gap-2 p-3 bg-black/20 rounded-lg">
              <Icon icon="solar:refresh-bold" className="w-4 h-4 animate-spin text-white/50" />
              <span className="text-sm text-white/50 font-minecraft-ten">{t('profiles.loadingProfiles')}</span>
            </div>
          ) : storeProfiles.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-3 bg-black/20 rounded-lg">
              <Icon icon="solar:folder-error-bold" className="w-4 h-4 text-amber-500" />
              <span className="text-sm text-amber-500 font-minecraft-ten">{t('profiles.no_profiles_available')}</span>
            </div>
          ) : (
            <>
              {/* Search Bar */}
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                  <Icon icon="solar:magnifer-bold" className="w-3 h-3 text-white/50" />
                </div>
                <input
                  type="text"
                  value={profileSearchValue}
                  onChange={(e) => setProfileSearchValue(e.target.value)}
                  placeholder={t('placeholders.search_profiles')}
                  className="w-full pl-7 pr-3 py-1.5 bg-black/20 border border-white/10 rounded-md text-xs font-minecraft-ten text-white placeholder-white/50 focus:border-accent focus:outline-none transition-colors"
                  disabled={isLoading}
                />
                {profileSearchValue && (
                  <button
                    onClick={() => setProfileSearchValue('')}
                    className="absolute inset-y-0 right-0 pr-2 flex items-center hover:bg-white/10 rounded-r-md"
                  >
                    <Icon icon="solar:close-circle-bold" className="w-3 h-3 text-white/50 hover:text-white" />
                  </button>
                )}
              </div>

              {/* Profile Grid */}
              <div className="grid grid-cols-3 gap-1.5 max-h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
                {displayedProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    onClick={() => {
                      onSourceProfileChange(profile.id);
                      setShowSourceSelectInput(true);
                    }}
                    disabled={isLoading}
                    className={cn(
                      "flex flex-col items-center gap-1 p-2 rounded-md bg-black/20 border transition-all duration-200 hover:bg-black/30 text-center",
                      selectedSourceProfileId === profile.id
                        ? "border-accent bg-accent/10"
                        : "border-white/10 hover:border-white/20",
                      isLoading && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className="w-5 h-5 rounded flex items-center justify-center overflow-hidden bg-black/40">
                      <Icon icon="solar:user-bold" className="w-3 h-3 text-white/70" />
                    </div>
                    <div className="flex-1 min-w-0 w-full">
                      <div className="text-xs font-minecraft-ten text-white truncate" title={profile.name}>
                        {profile.name}
                      </div>
                      <div className="text-xs text-white/40 font-minecraft-ten truncate">
                        {profile.game_version}
                      </div>
                    </div>
                    {selectedSourceProfileId === profile.id && (
                      <Icon icon="solar:check-circle-bold" className="w-3 h-3 text-accent flex-shrink-0" />
                    )}
                  </button>
                ))}

                {filteredProfiles.length > maxProfilesToShow && (
                  <button
                    onClick={handleLoadMoreProfiles}
                    disabled={isLoading}
                    className="flex flex-col items-center justify-center gap-1 p-2 rounded-md bg-black/20 border border-white/10 hover:border-white/20 hover:bg-black/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Icon icon="solar:add-circle-bold" className="w-4 h-4 text-white/50" />
                    <span className="text-xs font-minecraft-ten text-white/50">
                      +{Math.min(9, filteredProfiles.length - maxProfilesToShow)} more
                    </span>
                  </button>
                )}
              </div>

              {filteredProfiles.length === 0 && profileSearchValue && (
                <div className="text-center py-2">
                  <Icon icon="solar:search-bold" className="w-4 h-4 text-white/30 mx-auto mb-1" />
                  <span className="text-xs text-white/50 font-minecraft-ten">{t('profiles.noProfilesFound')}</span>
                </div>
              )}
            </>
          )}

          {storeProfiles.length === 0 && !profilesLoading && (
            <p className="text-xs text-amber-500 mt-2 text-center">
              You don't have any profiles to copy from. A new empty profile will be created if you proceed without selecting a source.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
