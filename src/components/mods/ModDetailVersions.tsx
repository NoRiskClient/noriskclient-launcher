"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UnifiedProjectDetails, UnifiedVersion } from "../../types/unified";
import { ModPlatform } from "../../types/unified";
import type { ModrinthSearchHit } from "../../types/modrinth";
import type { Profile } from "../../types/profile";
import UnifiedService from "../../services/unified-service";
import { ModrinthService } from "../../services/modrinth-service";
import { CurseForgeService } from "../../services/curseforge-service";
import { useProfileStore } from "../../store/profile-store";
import { useGlobalModalStore } from "../../hooks/useGlobalModal";
import { useThemeStore } from "../../store/useThemeStore";
import { ModrinthQuickInstallProfilesModal } from "../modrinth/v2/ModrinthQuickInstallProfilesModal";
import { ModrinthVersionItemV2 } from "../modrinth/v2/ModrinthVersionItemV2";
import { ProgressToast } from "../ui/ProgressToast";
import { installContentToProfile } from "../../services/content-service";
import { ContentType, type InstallContentPayload } from "../../types/content";
import { EventType, type EventPayload } from "../../types/events";
import { useNavigate } from "react-router-dom";
import { TagBadge } from "../ui/TagBadge";
import { Select, type SelectOption } from "../ui/Select";

interface ModDetailVersionsProps {
  project: UnifiedProjectDetails;
  targetProfile?: Profile;
}

// Helper to convert UnifiedProjectDetails to ModrinthSearchHit format
function toSearchHit(project: UnifiedProjectDetails): ModrinthSearchHit {
  return {
    project_id: project.id,
    project_type: project.project_type,
    slug: project.slug,
    title: project.title,
    description: project.description,
    author: project.author,
    categories: project.categories,
    display_categories: project.categories,
    client_side: (project.client_side as any) || "unknown",
    server_side: (project.server_side as any) || "unknown",
    downloads: project.downloads,
    follows: project.followers,
    icon_url: project.icon_url,
    latest_version: null,
    date_created: project.date_created,
    date_modified: project.date_modified,
    license: project.license?.id || "",
    gallery: project.gallery.map(g => g.url),
  };
}

// Helper to map project type to ContentType
function mapProjectTypeToContentType(projectType: string): ContentType | null {
  switch (projectType.toLowerCase()) {
    case 'mod':
      return ContentType.Mod;
    case 'resourcepack':
      return ContentType.ResourcePack;
    case 'shader':
      return ContentType.ShaderPack;
    case 'datapack':
      return ContentType.DataPack;
    default:
      return null;
  }
}

export function ModDetailVersions({ project, targetProfile }: ModDetailVersionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { profiles, fetchProfiles } = useProfileStore();
  const showModal = useGlobalModalStore(state => state.openModal);
  const hideModal = useGlobalModalStore(state => state.closeModal);
  const { accentColor } = useThemeStore();

  const [versions, setVersions] = useState<UnifiedVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installingVersions, setInstallingVersions] = useState<Record<string, boolean>>({});
  const [installingModpackVersions, setInstallingModpackVersions] = useState<Record<string, boolean>>({});
  const [installingProfiles, setInstallingProfiles] = useState<Record<string, boolean>>({});
  const [installStatus, setInstallStatus] = useState<Record<string, boolean>>({});
  const [installModalSearchHit, setInstallModalSearchHit] = useState<ModrinthSearchHit | null>(null);
  const [installModalVersion, setInstallModalVersion] = useState<UnifiedVersion | null>(null);
  const [displayedCount, setDisplayedCount] = useState(10);
  const [hoveredVersionId, setHoveredVersionId] = useState<string | null>(null);

  // Filters
  const [versionTypeFilter, setVersionTypeFilter] = useState<string>("all");
  const [gameVersionFilter, setGameVersionFilter] = useState<string>("all");
  const [loaderFilter, setLoaderFilter] = useState<string>("all");

  const isModpack = project.project_type.toLowerCase() === 'modpack';
  const projectAsSearchHit = useMemo(() => toSearchHit(project), [project]);

  // Fetch versions on mount
  useEffect(() => {
    async function loadVersions() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await UnifiedService.getModVersions({
          source: project.source,
          project_id: project.id,
        });

        // Sort by date, newest first
        const sorted = response.versions.sort((a, b) =>
          new Date(b.date_published).getTime() - new Date(a.date_published).getTime()
        );

        setVersions(sorted);
      } catch (err) {
        console.error("Failed to load versions:", err);
        setError(err instanceof Error ? err.message : "Failed to load versions");
      } finally {
        setIsLoading(false);
      }
    }

    loadVersions();
  }, [project.source, project.id]);

  // Get unique game versions and loaders for filters
  const availableGameVersions = useMemo(() => {
    const allVersions = [...new Set(versions.flatMap(v => v.game_versions))];
    return allVersions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }));
  }, [versions]);

  const availableLoaders = useMemo(() => {
    return [...new Set(versions.flatMap(v => v.loaders))].sort();
  }, [versions]);

  // Filter versions
  const filteredVersions = useMemo(() => {
    return versions.filter(v => {
      if (versionTypeFilter !== "all" && v.release_type !== versionTypeFilter) return false;
      if (gameVersionFilter !== "all" && !v.game_versions.includes(gameVersionFilter)) return false;
      if (loaderFilter !== "all" && !v.loaders.map(l => l.toLowerCase()).includes(loaderFilter.toLowerCase())) return false;
      return true;
    });
  }, [versions, versionTypeFilter, gameVersionFilter, loaderFilter]);

  const hasActiveFilters = versionTypeFilter !== "all" || gameVersionFilter !== "all" || loaderFilter !== "all";

  // Select options
  const versionTypeOptions: SelectOption[] = [
    { value: "all", label: t('mod_detail.versions.all_types') },
    { value: "release", label: t('mod_detail.versions.release') },
    { value: "beta", label: t('mod_detail.versions.beta') },
    { value: "alpha", label: t('mod_detail.versions.alpha') },
  ];

  const gameVersionOptions: SelectOption[] = [
    { value: "all", label: t('mod_detail.versions.all_game_versions') },
    ...availableGameVersions.map(v => ({ value: v, label: v })),
  ];

  const loaderOptions: SelectOption[] = [
    { value: "all", label: t('mod_detail.versions.all_loaders') },
    ...availableLoaders.map(l => ({ value: l, label: l })),
  ];

  const handleClearFilters = () => {
    setVersionTypeFilter("all");
    setGameVersionFilter("all");
    setLoaderFilter("all");
  };

  // Handle modpack version install (creates new profile)
  const handleModpackInstall = async (searchHit: ModrinthSearchHit, version: UnifiedVersion) => {
    if (!version.files?.length) {
      toast.error(t('mod_detail.no_files_for_version'));
      return;
    }

    const eventId = crypto.randomUUID();
    const toastId = `install-${eventId}`;
    let progressUnlisten: UnlistenFn | null = null;

    setInstallingModpackVersions(prev => ({ ...prev, [version.id]: true }));

    try {
      const primaryFile = version.files.find(f => f.primary) || version.files[0];
      const fileName = primaryFile.filename || project.title || "modpack";

      // Set up event listener for progress updates
      progressUnlisten = await listen<EventPayload>("state_event", (progressEvent) => {
        const progressPayload = progressEvent.payload;
        if (progressPayload.event_type !== EventType.TaskProgress) return;
        if (progressPayload.event_id !== eventId) return;

        const progress = (progressPayload.progress ?? 0) * 100;

        toast.custom(
          () => <ProgressToast message={`Installing ${fileName}`} progress={progress} />,
          { id: toastId, duration: Infinity }
        );
      });

      // Show initial progress toast
      toast.custom(
        () => <ProgressToast message={`Installing ${fileName}`} progress={0} />,
        { id: toastId, duration: Infinity }
      );

      let newProfileId: string;

      if (project.source === ModPlatform.CurseForge) {
        const projectId = parseInt(project.id);
        const fileId = parseInt(version.id);

        if (isNaN(projectId) || isNaN(fileId)) {
          throw new Error("Invalid project or file ID");
        }

        newProfileId = await CurseForgeService.downloadAndInstallCurseForgeModpack(
          projectId,
          fileId,
          primaryFile.filename,
          primaryFile.url,
          project.icon_url || undefined,
          primaryFile.size,
          eventId
        );
      } else {
        newProfileId = await ModrinthService.downloadAndInstallModpack(
          project.id,
          version.id,
          primaryFile.filename,
          primaryFile.url,
          project.icon_url || undefined,
          primaryFile.size,
          eventId
        );
      }

      // Clean up listener before showing success
      if (progressUnlisten) {
        progressUnlisten();
        progressUnlisten = null;
      }

      toast.success(t('mod_detail.install_success', { title: project.title, version: version.version_number }), { id: toastId, duration: 3000 });
      await fetchProfiles();
      navigate(`/profilesv2/${newProfileId}`);
    } catch (error: any) {
      console.error("Modpack installation failed:", error);
      toast.error(t('mod_detail.install_failed', { error: error.message || error }), { id: toastId });
    } finally {
      // Clean up listener
      if (progressUnlisten) {
        progressUnlisten();
      }
      setInstallingModpackVersions(prev => ({ ...prev, [version.id]: false }));
    }
  };

  const installVersionToProfile = async (profile: Profile, version: UnifiedVersion) => {
    if (!version.files?.length) {
      toast.error(t('mod_detail.no_files_available'));
      return;
    }

    setInstallingProfiles(prev => ({ ...prev, [profile.id]: true }));

    try {
      const primaryFile = version.files.find(f => f.primary) || version.files[0];
      const contentType = mapProjectTypeToContentType(project.project_type);

      if (!contentType) {
        toast.error(t('mod_detail.cannot_install_type', { type: project.project_type }));
        return;
      }

      const payload: InstallContentPayload = {
        profile_id: profile.id,
        project_id: project.id,
        version_id: version.id,
        file_name: primaryFile.filename,
        download_url: primaryFile.url,
        file_hash_sha1: primaryFile.hashes?.sha1,
        file_fingerprint: primaryFile.fingerprint,
        content_name: project.title,
        version_number: version.version_number,
        content_type: contentType,
        loaders: version.loaders,
        game_versions: version.game_versions,
        source: project.source,
      };

      await installContentToProfile(payload);
      const versionNumber = version.version_number ?? '';
      toast.success(t('mod_detail.installed_to_profile', { title: project.title, version: versionNumber, profile: profile.name }));
      setInstallStatus(prev => ({ ...prev, [profile.id]: true }));
    } catch (error) {
      console.error("Installation failed:", error);
      toast.error(t('mod_detail.install_failed', { error }));
    } finally {
      setInstallingProfiles(prev => ({ ...prev, [profile.id]: false }));
    }
  };

  const handleContentInstall = (searchHit: ModrinthSearchHit, version: UnifiedVersion) => {
    if (targetProfile) {
      void installVersionToProfile(targetProfile, version);
      return;
    }
    setInstallModalSearchHit(searchHit);
    setInstallModalVersion(version);
  };

  useEffect(() => {
    if (!installModalSearchHit || !installModalVersion) return;

    const searchHit = installModalSearchHit;
    const version = installModalVersion;
    const modalId = `install-version-${version.id}`;

    const handleProfileSelect = async (_: any, profile: Profile) => {
      if (!version.files?.length) {
        toast.error(t('mod_detail.no_files_available'));
        return;
      }

      setInstallingProfiles(prev => ({ ...prev, [profile.id]: true }));

      try {
        const primaryFile = version.files.find(f => f.primary) || version.files[0];
        const contentType = mapProjectTypeToContentType(project.project_type);

        if (!contentType) {
          toast.error(t('mod_detail.cannot_install_type', { type: project.project_type }));
          return;
        }

        const payload: InstallContentPayload = {
          profile_id: profile.id,
          project_id: project.id,
          version_id: version.id,
          file_name: primaryFile.filename,
          download_url: primaryFile.url,
          file_hash_sha1: primaryFile.hashes?.sha1,
          file_fingerprint: primaryFile.fingerprint,
          content_name: project.title,
          version_number: version.version_number,
          content_type: contentType,
          loaders: version.loaders,
          game_versions: version.game_versions,
          source: project.source,
        };

        await installContentToProfile(payload);
        toast.success(t('mod_detail.installed_to_profile', { title: project.title, version: version.version_number ?? '', profile: profile.name }));
        setInstallStatus(prev => ({ ...prev, [profile.id]: true }));
      } catch (error) {
        console.error("Installation failed:", error);
        toast.error(t('mod_detail.install_failed', { error }));
      } finally {
        setInstallingProfiles(prev => ({ ...prev, [profile.id]: false }));
      }
    };

    showModal(
      modalId,
      <ModrinthQuickInstallProfilesModal
        project={searchHit as any}
        profiles={profiles}
        onProfileSelect={handleProfileSelect}
        onClose={() => {
          hideModal(modalId);
          setInstallModalSearchHit(null);
          setInstallModalVersion(null);
          setInstallingProfiles({});
          setInstallStatus({});
        }}
        installingProfiles={installingProfiles}
        installStatus={installStatus}
      />,
      1200
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installModalSearchHit, installModalVersion, installingProfiles, installStatus, profiles, project.id]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Icon icon="solar:refresh-bold" className="w-6 h-6 text-white/50 animate-spin" />
        <span className="ml-2 text-white/50 font-minecraft-ten">{t('modrinth.loading_versions')}</span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="text-center py-12">
        <Icon icon="solar:danger-triangle-bold" className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-400 font-minecraft-ten text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-3">
      {/* Filter Bar */}
      <div
        className="mb-4 p-3 rounded-lg border backdrop-blur-sm"
        style={{
          backgroundColor: `${accentColor.value}10`,
          borderColor: `${accentColor.value}30`,
        }}
      >
        <div className="flex flex-wrap gap-2 items-center">
          {/* Version Type */}
          <Select
            value={versionTypeFilter}
            onChange={setVersionTypeFilter}
            options={versionTypeOptions}
            size="sm"
            className="w-32"
          />

          {/* Game Version */}
          <Select
            value={gameVersionFilter}
            onChange={setGameVersionFilter}
            options={gameVersionOptions}
            size="sm"
            className="w-44"
          />

          {/* Loader */}
          {availableLoaders.length > 0 && (
            <Select
              value={loaderFilter}
              onChange={setLoaderFilter}
              options={loaderOptions}
              size="sm"
              className="w-36"
            />
          )}

          {/* Results count */}
          <div className="ml-auto text-xs text-white/50 font-minecraft-ten">
            {filteredVersions.length} version{filteredVersions.length !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Active filters */}
        {hasActiveFilters && (
          <div className="flex items-center mt-2 gap-2">
            <div
              className="flex-1 border rounded-md h-[40px] overflow-x-auto overflow-y-hidden whitespace-nowrap hide-scrollbar"
              style={{
                backgroundColor: `${accentColor.value}08`,
                borderColor: `${accentColor.value}30`,
              }}
            >
              <div className="flex items-center gap-1.5 p-2">
                <TagBadge
                  variant="destructive"
                  className="cursor-pointer hover:brightness-110 transition-all flex-shrink-0 flex items-center"
                  onClick={handleClearFilters}
                >
                  <Icon icon="solar:trash-bin-trash-bold" className="w-3 h-3 mr-1.5" />
                  <span>{t('common.clear_all')}</span>
                </TagBadge>

                {versionTypeFilter !== "all" && (
                  <TagBadge variant="filter" className="inline-flex whitespace-nowrap">
                    {t('mod_detail.type')}: {versionTypeFilter}
                    <button
                      onClick={() => setVersionTypeFilter("all")}
                      className="ml-1.5 text-current opacity-70 hover:opacity-100"
                    >
                      <Icon icon="solar:close-circle-bold" className="w-3 h-3" />
                    </button>
                  </TagBadge>
                )}

                {gameVersionFilter !== "all" && (
                  <TagBadge variant="filter" className="inline-flex whitespace-nowrap">
                    {gameVersionFilter}
                    <button
                      onClick={() => setGameVersionFilter("all")}
                      className="ml-1.5 text-current opacity-70 hover:opacity-100"
                    >
                      <Icon icon="solar:close-circle-bold" className="w-3 h-3" />
                    </button>
                  </TagBadge>
                )}

                {loaderFilter !== "all" && (
                  <TagBadge variant="filter" className="inline-flex whitespace-nowrap">
                    {loaderFilter}
                    <button
                      onClick={() => setLoaderFilter("all")}
                      className="ml-1.5 text-current opacity-70 hover:opacity-100"
                    >
                      <Icon icon="solar:close-circle-bold" className="w-3 h-3" />
                    </button>
                  </TagBadge>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Version List - Using shared ModrinthVersionItemV2 */}
      {filteredVersions.length > 0 ? (
        <div className="space-y-2">
          {filteredVersions.slice(0, displayedCount).map((version) => (
            <ModrinthVersionItemV2
              key={version.id}
              version={version}
              project={projectAsSearchHit}
              versionStatus={null}
              isInstalling={installingVersions[version.id] || false}
              isInstallingModpackVersion={installingModpackVersions[version.id] || false}
              accentColor={accentColor}
              isHovered={hoveredVersionId === version.id}
              onMouseEnter={setHoveredVersionId}
              onMouseLeave={() => setHoveredVersionId(null)}
              onInstallClick={handleContentInstall}
              onInstallModpackVersionAsProfileClick={isModpack ? handleModpackInstall : undefined}
              noRiskStatus={version.isBlocked ? 'blocked' : null}
            />
          ))}

          {/* Load More Button */}
          {filteredVersions.length > displayedCount && (
            <button
              onClick={() => setDisplayedCount(prev => prev + 10)}
              className="w-full mt-2 py-2 rounded-lg text-xs font-minecraft-ten transition-colors"
              style={{
                backgroundColor: `${accentColor.value}15`,
                borderColor: `${accentColor.value}30`,
                color: accentColor.value,
              }}
            >
              Load More ({filteredVersions.length - displayedCount} more)
            </button>
          )}
        </div>
      ) : (
        <div
          className="relative overflow-hidden transition-colors duration-150 rounded-md p-4 text-sm text-gray-400 text-center border-2 border-b-4 backdrop-blur-md"
          style={{
            borderColor: `${accentColor.value}60`,
            borderBottomColor: accentColor.value,
            backgroundColor: `${accentColor.value}15`,
          }}
        >
          No versions match the selected filters.
        </div>
      )}
    </div>
  );
}
