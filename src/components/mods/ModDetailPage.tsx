"use client";

import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import { Icon } from "@iconify/react";
import { ModrinthService } from "../../services/modrinth-service";
import { setDiscordState } from "../../utils/discordRpc";
import { CurseForgeService } from "../../services/curseforge-service";
import type { ModrinthProject } from "../../types/modrinth";
import type { CurseForgeMod } from "../../types/curseforge";
import type { UnifiedProjectDetails, UnifiedGalleryImage, UnifiedProjectLinks, UnifiedTeamMember, UnifiedProjectDependency } from "../../types/unified";
import { UnifiedDependencyType } from "../../types/unified";
import { ModPlatform } from "../../types/unified";
import { ModDetailHeader } from "./ModDetailHeader";
import { ModDetailGallery } from "./ModDetailGallery";
import { ModDetailDescription } from "./ModDetailDescription";
import { ModDetailVersions } from "./ModDetailVersions";
import { ModDetailSidebar } from "./ModDetailSidebar";
import { useThemeStore } from "../../store/useThemeStore";

// Convert Modrinth project to unified format
function modrinthToUnified(
  project: ModrinthProject,
  authorName?: string,
  authorAvatarUrl?: string | null,
  teamMembers?: UnifiedTeamMember[],
  dependencies?: UnifiedProjectDependency[]
): UnifiedProjectDetails {
  return {
    id: project.id,
    source: ModPlatform.Modrinth,
    title: project.title,
    slug: project.slug,
    description: project.description,
    body: project.body,
    author: authorName || project.team, // Use provided author name or fallback to team ID
    author_avatar_url: authorAvatarUrl || null,
    icon_url: project.icon_url,
    downloads: project.downloads,
    followers: project.followers,
    categories: project.categories,
    gallery: project.gallery.map((img, index) => ({
      url: img.url,
      thumbnail_url: img.url, // Modrinth doesn't have separate thumbnails
      title: img.title,
      description: img.description,
      featured: img.featured,
      ordering: img.ordering ?? index,
    })),
    links: {
      issues: project.issues_url,
      source: project.source_url,
      wiki: project.wiki_url,
      discord: project.discord_url,
      website: null, // Modrinth doesn't have a separate website field
    },
    project_type: project.project_type,
    project_url: `https://modrinth.com/${project.project_type}/${project.slug}`,
    date_created: project.published,
    date_modified: project.updated,
    license: project.license ? {
      id: project.license.id,
      name: project.license.name,
      url: project.license.url,
    } : null,
    donation_urls: (project.donation_urls || []).map(d => ({
      platform: d.platform,
      url: d.url,
    })),
    client_side: project.client_side,
    server_side: project.server_side,
    team_members: teamMembers || [],
    game_versions: project.game_versions || [],
    loaders: project.loaders || [],
    dependencies: dependencies || [],
  };
}

// Helper to convert CurseForge modLoader ID to name
function getCurseForgeLoaderName(loaderId: number | undefined): string | null {
  switch (loaderId) {
    case 1: return "Forge";
    case 4: return "Fabric";
    case 5: return "Quilt";
    case 6: return "NeoForge";
    default: return null;
  }
}

// Convert CurseForge mod to unified format
function curseforgeToUnified(
  mod: CurseForgeMod,
  fullDescription?: string,
  dependencies?: UnifiedProjectDependency[]
): UnifiedProjectDetails {
  // Convert CurseForge authors to team members
  const teamMembers: UnifiedTeamMember[] = (mod.authors || []).map(author => ({
    username: author.name,
    avatar_url: null, // CurseForge doesn't provide author avatars
    role: "Author",
    profile_url: author.url,
  }));

  // Extract unique game versions and loaders from latestFilesIndexes
  const gameVersionsSet = new Set<string>();
  const loadersSet = new Set<string>();

  (mod.latestFilesIndexes || []).forEach(fileIndex => {
    if (fileIndex.gameVersion) {
      gameVersionsSet.add(fileIndex.gameVersion);
    }
    const loaderName = getCurseForgeLoaderName(fileIndex.modLoader);
    if (loaderName) {
      loadersSet.add(loaderName);
    }
  });

  return {
    id: mod.id.toString(),
    source: ModPlatform.CurseForge,
    title: mod.name,
    slug: mod.slug,
    description: mod.summary,
    body: fullDescription || mod.summary, // Use full description if available, fallback to summary
    author: mod.authors?.[0]?.name || "Unknown",
    author_avatar_url: null, // CurseForge doesn't provide author avatars
    icon_url: mod.logo?.url || null,
    downloads: mod.downloadCount,
    followers: mod.thumbsUpCount || 0,
    categories: mod.categories?.map(c => c.name) || [],
    gallery: (mod.screenshots || []).map((img, index) => ({
      url: img.url,
      thumbnail_url: img.thumbnailUrl,
      title: img.title,
      description: img.description,
      featured: index === 0,
      ordering: index,
    })),
    links: {
      issues: mod.links?.issuesUrl || null,
      source: mod.links?.sourceUrl || null,
      wiki: mod.links?.wikiUrl || null,
      discord: null, // CurseForge doesn't have discord in standard API
      website: mod.links?.websiteUrl || null,
    },
    project_type: getProjectTypeFromClassId(mod.classId),
    project_url: `https://www.curseforge.com/minecraft/${getProjectTypeFromClassId(mod.classId)}s/${mod.slug}`,
    date_created: mod.dateCreated,
    date_modified: mod.dateModified,
    license: null, // CurseForge doesn't expose license in API
    donation_urls: [], // CurseForge doesn't have donation URLs
    client_side: null,
    server_side: null,
    team_members: teamMembers,
    game_versions: Array.from(gameVersionsSet),
    loaders: Array.from(loadersSet),
    dependencies: dependencies || [],
  };
}

function getProjectTypeFromClassId(classId: number | undefined): string {
  switch (classId) {
    case 6: return "mod";
    case 4471: return "modpack";
    case 12: return "resourcepack";
    case 6552: return "shader";
    case 6945: return "datapack";
    default: return "mod";
  }
}

interface ModDetailPageProps {
  /**
   * Override the `source` URL param. Use when hosting the detail page
   * inside another surface (e.g. the V3 Add-content sheet) so the route
   * itself doesn't need to change.
   */
  sourceOverride?: string;
  /** Same idea for projectId. */
  projectIdOverride?: string;
  /**
   * Override the default back behavior (`navigate(-1)`). Hosts that render
   * this inside a stacked layer can pass their own handler to pop just
   * that layer instead of the router history.
   */
  onBack?: () => void;
  /**
   * When embedded inside another surface (like the V3 sheet) the host
   * already provides its own back control — rendering the page's internal
   * back button on top would duplicate it. Set this to suppress the
   * built-in back button; `handleBack` still fires via `onBack` from the
   * host chrome.
   */
  hideBackButton?: boolean;
  targetProfile?: import("../../types/profile").Profile;
}

export function ModDetailPage({
  sourceOverride,
  projectIdOverride,
  onBack,
  hideBackButton,
  targetProfile,
}: ModDetailPageProps = {}) {
  const { t } = useTranslation();
  const params = useParams<{ source: string; projectId: string }>();
  const source = sourceOverride ?? params.source;
  const projectId = projectIdOverride ?? params.projectId;
  const navigate = useNavigate();
  const { accentColor } = useThemeStore();

  const [project, setProject] = useState<UnifiedProjectDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState(false);

  useEffect(() => { setDiscordState("Viewing a Mod"); }, []);

  useEffect(() => {
    async function loadProject() {
      if (!source || !projectId) {
        setError(t('mod_detail.invalid_url_params'));
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        if (source.toLowerCase() === "modrinth") {
          const projects = await ModrinthService.getProjectDetails([projectId]);
          if (projects.length > 0) {
            const modrinthProject = projects[0];

            // Fetch author name from search (this returns org names correctly, e.g., "Cobble Studios")
            let authorName: string | undefined;
            let authorAvatarUrl: string | null = null;
            let teamMembers: UnifiedTeamMember[] = [];

            // First, try to get the author from search results (handles orgs correctly)
            try {
              const searchResponse = await ModrinthService.searchProjects(
                modrinthProject.slug,
                modrinthProject.project_type,
                undefined,
                undefined,
                1
              );
              if (searchResponse.hits.length > 0 && searchResponse.hits[0].project_id === modrinthProject.id) {
                authorName = searchResponse.hits[0].author || undefined;
              }
            } catch (searchErr) {
              console.warn("Failed to fetch author from search:", searchErr);
            }

            // Also fetch team members for the team list in sidebar
            try {
              const members = await ModrinthService.getProjectMembers(projectId);
              if (members.length > 0) {
                // Sort by ordering for display
                const sortedMembers = [...members].sort((a, b) => a.ordering - b.ordering);

                // If we didn't get author from search, use owner from team
                if (!authorName) {
                  const owner = members.find(m => m.role.toLowerCase() === "owner");
                  const projectLead = owner || sortedMembers[0];
                  authorName = projectLead.user.username;
                  authorAvatarUrl = projectLead.user.avatar_url;
                } else {
                  // Get avatar from owner for display
                  const owner = members.find(m => m.role.toLowerCase() === "owner");
                  if (owner) {
                    authorAvatarUrl = owner.user.avatar_url;
                  }
                }

                // Convert all members to unified format
                teamMembers = sortedMembers.map(m => ({
                  username: m.user.username,
                  avatar_url: m.user.avatar_url,
                  role: m.role,
                  profile_url: `https://modrinth.com/user/${m.user.username}`,
                }));
              }
            } catch (memberErr) {
              console.warn("Failed to fetch team members:", memberErr);
              // Continue without team info
            }

            // Fetch dependencies from the latest version
            let dependencies: UnifiedProjectDependency[] = [];
            try {
              const versions = await ModrinthService.getModVersions(projectId);
              if (versions.length > 0) {
                // Get dependencies from the first (featured/latest) version
                const latestVersion = versions[0];
                const deps = latestVersion.dependencies || [];

                // Filter to only required/optional dependencies with project_ids
                const depsWithProjects = deps.filter(
                  d => d.project_id && (d.dependency_type === 'required' || d.dependency_type === 'optional')
                );

                if (depsWithProjects.length > 0) {
                  // Fetch project details for all dependencies
                  const depProjectIds = depsWithProjects.map(d => d.project_id!);
                  const depProjects = await ModrinthService.getProjectDetails(depProjectIds);

                  // Map to unified format
                  dependencies = depsWithProjects.map(dep => {
                    const project = depProjects.find(p => p.id === dep.project_id);
                    return {
                      project_id: dep.project_id!,
                      title: project?.title || dep.project_id!,
                      slug: project?.slug || dep.project_id!,
                      icon_url: project?.icon_url || null,
                      dependency_type: dep.dependency_type === 'required'
                        ? UnifiedDependencyType.Required
                        : UnifiedDependencyType.Optional,
                      source: ModPlatform.Modrinth,
                    };
                  });
                }
              }
            } catch (depsErr) {
              console.warn("Failed to fetch dependencies:", depsErr);
              // Continue without dependencies
            }

            setProject(modrinthToUnified(modrinthProject, authorName, authorAvatarUrl, teamMembers, dependencies));
          } else {
            setError(t('mod_detail.project_not_found'));
          }
        } else if (source.toLowerCase() === "curseforge") {
          const modId = parseInt(projectId, 10);
          if (isNaN(modId)) {
            setError(t('mod_detail.invalid_curseforge_id'));
            return;
          }
          const response = await CurseForgeService.getModsByIds([modId]);
          if (response.data && response.data.length > 0) {
            const mod = response.data[0];

            // Fetch full description (HTML) from CurseForge API
            let fullDescription: string | undefined;
            try {
              fullDescription = await CurseForgeService.getModDescription(modId);
            } catch (descErr) {
              console.warn("Failed to fetch CurseForge description:", descErr);
              // Continue without full description - will fallback to summary
            }

            setProject(curseforgeToUnified(mod, fullDescription));
          } else {
            setError(t('mod_detail.mod_not_found'));
          }
        } else {
          setError(`Unknown source: ${source}`);
        }
      } catch (err) {
        console.error("Failed to load project:", err);
        setError(err instanceof Error ? err.message : "Failed to load project");
      } finally {
        setIsLoading(false);
      }
    }

    loadProject();
  }, [source, projectId]);

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    navigate(-1);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col h-full p-6">
        {!hideBackButton && (
          <button
            onClick={handleBack}
            className="flex items-center gap-2 text-white/70 hover:text-white mb-6 font-minecraft-ten transition-colors"
          >
            <Icon icon="solar:arrow-left-bold" className="w-5 h-5" />
            <span>{t('common.back')}</span>
          </button>
        )}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Icon icon="solar:refresh-bold" className="w-12 h-12 text-white/50 animate-spin" />
            <span className="text-white/50 font-minecraft-ten">{t('mod_detail.loading_project')}</span>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !project) {
    return (
      <div className="flex flex-col h-full p-6">
        {!hideBackButton && (
          <button
            onClick={handleBack}
            className="flex items-center gap-2 text-white/70 hover:text-white mb-6 font-minecraft-ten transition-colors"
          >
            <Icon icon="solar:arrow-left-bold" className="w-5 h-5" />
            <span>{t('common.back')}</span>
          </button>
        )}
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Icon icon="solar:danger-triangle-bold" className="w-12 h-12 text-red-500" />
            <span className="text-red-400 font-minecraft-ten">{error || t('mod_detail.project_not_found')}</span>
            <button
              onClick={handleBack}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white font-minecraft-ten transition-colors"
            >
              {t('mod_detail.go_back')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Back Button — hidden when embedded inside a host that provides its
          own back control (e.g. the V3 Add-content sheet's breadcrumb). */}
      {!hideBackButton && (
        <div className="px-6 pt-6 pb-4">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 text-white/70 hover:text-white font-minecraft-ten transition-colors"
          >
            <Icon icon="solar:arrow-left-bold" className="w-5 h-5" />
            <span>{t('common.back')}</span>
          </button>
        </div>
      )}

      {/* Scrollable Content — `custom-scrollbar` gives this area the same
          accent-themed scrollbar as the rest of the V3 UI; without it the
          native Chromium default shows up here and reads as foreign. */}
      <div className={`flex-1 overflow-y-auto custom-scrollbar px-6 pb-6 ${hideBackButton ? "pt-6" : ""}`}>
        {/* Header */}
        <ModDetailHeader
          project={project}
          accentColor={accentColor}
          showVersions={showVersions}
          onToggleVersions={() => setShowVersions(!showVersions)}
          targetProfile={targetProfile}
        />

        {showVersions ? (
          /* Versions View */
          <div className="mt-6">
            <ModDetailVersions project={project} targetProfile={targetProfile} />
          </div>
        ) : (
          /* Default View: Gallery + Description + Sidebar */
          <>
            {/* Gallery */}
            {project.gallery.length > 0 && (
              <div className="mt-6">
                <ModDetailGallery images={project.gallery} />
              </div>
            )}

            {/* Content Layout */}
            <div className="mt-6 flex flex-col lg:flex-row gap-6">
              {/* Main Content - grows to fill space */}
              <div className="flex-1 min-w-0">
                <ModDetailDescription
                  body={project.body}
                  source={project.source}
                />
              </div>

              {/* Sidebar - fixed max width */}
              <div className="w-full lg:w-72 xl:w-80 flex-shrink-0">
                <ModDetailSidebar
                  project={project}
                  accentColor={accentColor}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
