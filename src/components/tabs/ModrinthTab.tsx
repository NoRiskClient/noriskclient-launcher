"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModrinthSearch } from "../modrinth/ModrinthSearch";
import type { Profile } from "../../types/profile";
import { listProfiles } from "../../services/profile-service";
import { LoadingState } from "../ui/LoadingState";
import { ErrorMessage } from "../ui/ErrorMessage";
import { Card } from "../ui/Card";
import { useThemeStore } from "../../store/useThemeStore";
import { ModrinthFilters } from "../modrinth/ModrinthFilters";
import type { ModrinthProjectType } from "../../types/modrinth";

interface ModrinthTabProps {
  profiles?: Profile[];
}

export function ModrinthTab({
  profiles: initialProfiles = [],
}: ModrinthTabProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [profiles, setProfiles] = useState<Profile[]>(initialProfiles);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const accentColor = useThemeStore((state) => state.accentColor);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedGameVersions, setSelectedGameVersions] = useState<string[]>([]);
  const [selectedLoaders, setSelectedLoaders] = useState<string[]>([]);
  const [selectedEnvironmentOptions, setSelectedEnvironmentOptions] = useState<string[]>([]);
  const [projectType, setProjectType] = useState<ModrinthProjectType>("mod");

  useEffect(() => {
    const loadProfiles = async () => {
      try {
        const fetchedProfiles = await listProfiles();
        setProfiles(fetchedProfiles);
        setProfilesLoaded(true);
      } catch (err) {
        console.error("Failed to load profiles:", err);
        setError(
          `Failed to load profiles: ${err instanceof Error ? err.message : String(err)}`,
        );
        setProfilesLoaded(true);
      }
    };

    if (initialProfiles.length === 0 && !profilesLoaded) {
      loadProfiles();
    } else {
      setProfilesLoaded(true);
    }
  }, [initialProfiles, profilesLoaded]);

  const handleInstallSuccess = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const handleProjectTypeChange = useCallback((type: ModrinthProjectType) => {
    setProjectType(type);
    // Clear filters when changing project type
    setSelectedCategories([]);
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      {error && <ErrorMessage message={error} />}

      {!profilesLoaded ? (
        <LoadingState message={t('profiles.loadingProfiles')} />
      ) : (
        <div className="flex-1 overflow-hidden flex space-x-4">
          <div className="flex-1 overflow-hidden">
            <ModrinthSearch
              key={`search-${refreshKey}`}
              profiles={profiles}
              onInstallSuccess={handleInstallSuccess}
              className="h-full"
              initialProjectType={projectType}
              onProjectTypeChange={handleProjectTypeChange}
              selectedCategories={selectedCategories}
              selectedGameVersions={selectedGameVersions}
              selectedLoaders={selectedLoaders}
              selectedEnvironmentOptions={selectedEnvironmentOptions}
            />
          </div>
          <div className="w-1/4 max-w-xs flex-shrink-0">
            <ModrinthFilters
              projectType={projectType}
              onFilterChange={setSelectedCategories}
              onGameVersionChange={setSelectedGameVersions}
              onLoaderChange={setSelectedLoaders}
              onEnvironmentChange={setSelectedEnvironmentOptions}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default ModrinthTab;
