"use client";

import React, { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UnifiedProjectDetails, UnifiedVersion, UnifiedModSearchResult } from "../../types/unified";
import { ModPlatform } from "../../types/unified";
import type { AccentColor } from "../../store/useThemeStore";
import type { Profile } from "../../types/profile";
import { TagBadge } from "../ui/TagBadge";
import { ActionButton } from "../ui/ActionButton";
import { ProgressToast } from "../ui/ProgressToast";
import { openExternalUrl } from "../../services/tauri-service";
import { useProfileStore } from "../../store/profile-store";
import { useGlobalModalStore } from "../../hooks/useGlobalModal";
import { ModrinthQuickInstallProfilesModal } from "../modrinth/v2/ModrinthQuickInstallProfilesModal";
import UnifiedService from "../../services/unified-service";
import { ModrinthService } from "../../services/modrinth-service";
import { CurseForgeService } from "../../services/curseforge-service";
import { installContentToProfile } from "../../services/content-service";
import { ContentType, type InstallContentPayload } from "../../types/content";
import { EventType, type EventPayload } from "../../types/events";
import { useNavigate } from "react-router-dom";

interface ModDetailHeaderProps {
  project: UnifiedProjectDetails;
  accentColor: AccentColor;
  showVersions: boolean;
  onToggleVersions: () => void;
  targetProfile?: Profile;
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

function getProjectTypeIcon(type: string): string {
  switch (type) {
    case "mod": return "pixel:bolt-solid";
    case "modpack": return "pixel:folder-open-solid";
    case "resourcepack": return "pixel:image-solid";
    case "shader": return "pixel:sun-solid";
    case "datapack": return "pixel:cube-solid";
    default: return "pixel:cube-solid";
  }
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
    case 'modpack':
      return null; // Modpacks are handled differently
    default:
      return null;
  }
}

// Helper to find best version for a profile
function findBestVersionForProfile(profile: Profile, versions: UnifiedVersion[]): UnifiedVersion | null {
  if (!profile || !versions || versions.length === 0) return null;

  // First try: find a version matching both game version and loader
  if (profile.game_version && profile.loader) {
    const exactMatch = versions.find(v =>
      v.game_versions.includes(profile.game_version!) &&
      v.loaders.map(l => l.toLowerCase()).includes(profile.loader!.toLowerCase())
    );
    if (exactMatch) return exactMatch;
  }

  // Second try: match just game version
  if (profile.game_version) {
    const gameVersionMatch = versions.find(v =>
      v.game_versions.includes(profile.game_version!)
    );
    if (gameVersionMatch) return gameVersionMatch;
  }

  // Last resort: just return the latest version
  return versions[0];
}

export function ModDetailHeader({ project, accentColor, showVersions, onToggleVersions, targetProfile }: ModDetailHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { profiles, fetchProfiles } = useProfileStore();
  const showModal = useGlobalModalStore(state => state.openModal);
  const hideModal = useGlobalModalStore(state => state.closeModal);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installingProfiles, setInstallingProfiles] = useState<Record<string, boolean>>({});
  const [installStatus, setInstallStatus] = useState<Record<string, boolean>>({});
  const [installModalVersions, setInstallModalVersions] = useState<UnifiedVersion[] | null>(null);

  // Check if this is a modpack
  const isModpack = project.project_type.toLowerCase() === 'modpack';

  const handleOpenProjectPage = async () => {
    try {
      await openExternalUrl(project.project_url);
    } catch (error) {
      console.error("Failed to open URL:", error);
      toast.error(t('common.open_link_failed'));
    }
  };

  // Convert UnifiedProjectDetails to format expected by modal
  const projectAsSearchResult: UnifiedModSearchResult = {
    project_id: project.id,
    source: project.source,
    title: project.title,
    slug: project.slug,
    description: project.description,
    author: project.author,
    categories: project.categories,
    display_categories: project.categories,
    downloads: project.downloads,
    follows: project.followers,
    icon_url: project.icon_url,
    project_url: project.project_url,
    project_type: project.project_type,
    gallery: project.gallery.map(g => g.url),
  };

  // Handle modpack installation (creates a new profile)
  const handleModpackInstall = async () => {
    const eventId = crypto.randomUUID();
    const toastId = `install-${eventId}`;
    let progressUnlisten: UnlistenFn | null = null;

    setIsInstalling(true);
    toast.loading(t('mod_detail.fetching_versions', { title: project.title }), { id: toastId });

    try {
      const response = await UnifiedService.getModVersions({
        source: project.source,
        project_id: project.id,
      });
      const allVersions = response.versions;

      if (!allVersions || allVersions.length === 0) {
        throw new Error(t('mod_detail.no_versions_found'));
      }

      // Sort all versions by date published, newest first
      const sortedVersions = allVersions.sort((a, b) =>
        new Date(b.date_published).getTime() - new Date(a.date_published).getTime()
      );

      // Try to find the latest 'release' version
      let latestVersion = sortedVersions.find(v => v.release_type === 'release');
      if (!latestVersion) {
        latestVersion = sortedVersions[0];
      }

      if (!latestVersion?.files?.length) {
        throw new Error(t('mod_detail.no_files_in_version'));
      }

      const primaryFile = latestVersion.files.find(f => f.primary) || latestVersion.files[0];
      if (!primaryFile) {
        throw new Error(t('mod_detail.no_primary_file'));
      }

      const fileName = primaryFile.filename || project.title || "modpack";

      // Set up event listener for progress updates
      progressUnlisten = await listen<EventPayload>("state_event", (progressEvent) => {
        const progressPayload = progressEvent.payload;
        if (progressPayload.event_type !== EventType.TaskProgress) return;
        if (progressPayload.event_id !== eventId) return;

        const progress = (progressPayload.progress ?? 0) * 100; // Convert 0-1 to 0-100

        // Update toast with progress
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
        const fileId = parseInt(latestVersion.id);

        if (isNaN(projectId) || isNaN(fileId)) {
          throw new Error(t('mod_detail.invalid_curseforge_ids'));
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
          latestVersion.id,
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

      toast.success(t('mod_detail.installed_as_profile', { title: project.title }), { id: toastId, duration: 3000 });

      // Refresh profiles and navigate
      await fetchProfiles();
      navigate(`/profilesv2/${newProfileId}`);

    } catch (error: any) {
      console.error("Modpack installation failed:", error);
      toast.error(t('mod_detail.modpack_install_failed', { error: error.message || error }), { id: toastId });
    } finally {
      // Clean up listener
      if (progressUnlisten) {
        progressUnlisten();
      }
      setIsInstalling(false);
    }
  };

  const installVersionToProfile = async (profile: Profile, bestVersion: UnifiedVersion) => {
    setInstallingProfiles(prev => ({ ...prev, [profile.id]: true }));
    try {
      const primaryFile = bestVersion.files.find(f => f.primary) || bestVersion.files[0];
      if (!primaryFile) {
        toast.error(t('mod_detail.no_download_file'));
        return;
      }

      const contentType = mapProjectTypeToContentType(project.project_type);
      if (!contentType) {
        toast.error(t('mod_detail.cannot_install_type', { type: project.project_type }));
        return;
      }

      const payload: InstallContentPayload = {
        profile_id: profile.id,
        project_id: project.id,
        version_id: bestVersion.id,
        file_name: primaryFile.filename,
        download_url: primaryFile.url,
        file_hash_sha1: primaryFile.hashes?.sha1,
        file_fingerprint: primaryFile.fingerprint,
        content_name: project.title,
        version_number: bestVersion.version_number,
        content_type: contentType,
        loaders: bestVersion.loaders,
        game_versions: bestVersion.game_versions,
        source: project.source,
      };

      await installContentToProfile(payload);
      toast.success(t('mod_detail.installed_to_profile', { title: project.title, version: bestVersion.version_number, profile: profile.name }));
      setInstallStatus(prev => ({ ...prev, [profile.id]: true }));
    } catch (error) {
      console.error("Installation failed:", error);
      toast.error(t('mod_detail.install_failed', { error }));
    } finally {
      setInstallingProfiles(prev => ({ ...prev, [profile.id]: false }));
    }
  };

  const handleInstallClick = async () => {
    if (isModpack) {
      handleModpackInstall();
      return;
    }

    setIsInstalling(true);

    try {
      const response = await UnifiedService.getModVersions({
        source: project.source,
        project_id: project.id,
      });

      if (response.versions.length === 0) {
        toast.error(t('mod_detail.no_versions_available'));
        return;
      }

      if (targetProfile) {
        const bestVersion = findBestVersionForProfile(targetProfile, response.versions);
        if (!bestVersion) {
          toast.error(t('mod_detail.no_compatible_version', { profile: targetProfile.name }));
          return;
        }
        await installVersionToProfile(targetProfile, bestVersion);
        return;
      }

      setInstallModalVersions(response.versions);
    } catch (error) {
      console.error("Failed to fetch versions:", error);
      toast.error(t('mod_detail.load_versions_failed'));
    } finally {
      setIsInstalling(false);
    }
  };

  useEffect(() => {
    if (!installModalVersions) return;

    const versions = installModalVersions;
    const modalId = `install-${project.id}`;

    const handleProfileSelect = async (_: any, profile: Profile) => {
      const bestVersion = findBestVersionForProfile(profile, versions);
      if (!bestVersion) {
        toast.error(t('mod_detail.no_compatible_version', { profile: profile.name }));
        return;
      }

      setInstallingProfiles(prev => ({ ...prev, [profile.id]: true }));

      try {
        const primaryFile = bestVersion.files.find(f => f.primary) || bestVersion.files[0];
        if (!primaryFile) {
          toast.error(t('mod_detail.no_download_file'));
          return;
        }

        const contentType = mapProjectTypeToContentType(project.project_type);
        if (!contentType) {
          toast.error(t('mod_detail.cannot_install_type', { type: project.project_type }));
          return;
        }

        const payload: InstallContentPayload = {
          profile_id: profile.id,
          project_id: project.id,
          version_id: bestVersion.id,
          file_name: primaryFile.filename,
          download_url: primaryFile.url,
          file_hash_sha1: primaryFile.hashes?.sha1,
          file_fingerprint: primaryFile.fingerprint,
          content_name: project.title,
          version_number: bestVersion.version_number,
          content_type: contentType,
          loaders: bestVersion.loaders,
          game_versions: bestVersion.game_versions,
          source: project.source,
        };

        await installContentToProfile(payload);
        toast.success(t('mod_detail.installed_to_profile', { title: project.title, version: bestVersion.version_number, profile: profile.name }));
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
        project={projectAsSearchResult as any}
        profiles={profiles}
        onProfileSelect={handleProfileSelect}
        onClose={() => {
          hideModal(modalId);
          setInstallModalVersions(null);
          setIsInstalling(false);
          setInstallingProfiles({});
          setInstallStatus({});
        }}
        installingProfiles={installingProfiles}
        installStatus={installStatus}
      />,
      1200
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installModalVersions, installingProfiles, installStatus, profiles, project.id]);

  return (
    <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 bg-black/20 rounded-lg p-4 border border-white/10">
      {/* Project Icon */}
      <div
        className="w-24 h-24 sm:w-32 sm:h-32 flex-shrink-0 rounded-lg overflow-hidden border self-center sm:self-start"
        style={{
          borderColor: `${accentColor.value}30`,
          backgroundColor: `${accentColor.value}10`,
        }}
      >
        {project.icon_url ? (
          <img
            src={project.icon_url}
            alt={`${project.title} icon`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gray-700/50 flex items-center justify-center">
            <Icon icon={getProjectTypeIcon(project.project_type)} className="w-12 h-12 text-gray-500" />
          </div>
        )}
      </div>

      {/* Project Info */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Title Row */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
          <div>
            <button
              onClick={handleOpenProjectPage}
              className="text-2xl font-minecraft-ten text-white leading-tight hover:text-accent hover:underline transition-colors text-left"
            >
              {project.title}
            </button>
            {project.author && (
              <p className="text-sm text-gray-400 font-minecraft-ten mt-1">
                by {project.author}
              </p>
            )}
          </div>

          {/* Stats + Install Button */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-4 text-sm text-white/70 font-minecraft-ten">
              <div className="flex items-center gap-1">
                <Icon icon="solar:download-minimalistic-bold" className="w-4 h-4" />
                <span>{formatNumber(project.downloads)}</span>
              </div>
              <div className="flex items-center gap-1">
                <Icon icon="solar:heart-bold" className="w-4 h-4" />
                <span>{formatNumber(project.followers)}</span>
              </div>
            </div>

            {/* Install Button + Versions Toggle */}
            <div className="flex items-center gap-1">
              <ActionButton
                label={isInstalling ? "Installing..." : "Install"}
                icon={isInstalling ? "solar:refresh-bold" : "solar:download-minimalistic-bold"}
                iconClassName={isInstalling ? "animate-spin-slow" : ""}
                variant={isInstalling ? "secondary" : "primary"}
                size="sm"
                disabled={isInstalling}
                onClick={handleInstallClick}
              />
              <ActionButton
                icon={showVersions ? "solar:alt-arrow-up-bold" : "solar:alt-arrow-down-bold"}
                variant="icon-only"
                tooltip={showVersions ? "Hide Versions" : "Show Versions"}
                onClick={onToggleVersions}
                size="sm"
              />
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-gray-300 font-minecraft-ten mt-3 line-clamp-2">
          {project.description}
        </p>

        {/* Meta Row */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {/* Source Badge */}
          <TagBadge
            variant={project.source === ModPlatform.Modrinth ? "success" : "warning"}
            size="sm"
          >
            <Icon
              icon={project.source === ModPlatform.Modrinth ? "simple-icons:modrinth" : "simple-icons:curseforge"}
              className="w-3 h-3 mr-1"
            />
            {project.source}
          </TagBadge>

          {/* Project Type */}
          <TagBadge variant="info" size="sm">
            <Icon icon={getProjectTypeIcon(project.project_type)} className="w-3 h-3 mr-1" />
            <span className="capitalize">{project.project_type}</span>
          </TagBadge>

          {/* Categories */}
          {project.categories.slice(0, 4).map((category) => (
            <TagBadge key={category} size="sm">
              {category.replace(/-/g, " ")}
            </TagBadge>
          ))}
          {project.categories.length > 4 && (
            <span className="text-xs text-white/50 font-minecraft-ten">
              +{project.categories.length - 4} more
            </span>
          )}
        </div>

      </div>
    </div>
  );
}
