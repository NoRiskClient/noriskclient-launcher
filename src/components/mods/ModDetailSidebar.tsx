"use client";

import React from "react";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n/i18n";
import { useNavigate } from "react-router-dom";
import type { UnifiedProjectDetails } from "../../types/unified";
import { UnifiedDependencyType } from "../../types/unified";
import type { AccentColor } from "../../store/useThemeStore";
import { openExternalUrl } from "../../services/tauri-service";

interface ModDetailSidebarProps {
  project: UnifiedProjectDetails;
  accentColor: AccentColor;
}

interface LinkItemProps {
  icon: string;
  label: string;
  url: string | null;
}

function LinkItem({ icon, label, url }: LinkItemProps) {
  if (!url) return null;

  const handleClick = async () => {
    try {
      await openExternalUrl(url);
    } catch (error) {
      console.error("Failed to open URL:", error);
      toast.error(i18n.t('common.open_link_failed'));
    }
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-black/20 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-left group"
    >
      <Icon icon={icon} className="w-4 h-4 text-white/70 group-hover:text-white" />
      <span className="text-sm font-minecraft-ten text-white/70 group-hover:text-white truncate">
        {label}
      </span>
      <Icon
        icon="solar:arrow-right-up-bold"
        className="w-3 h-3 text-white/30 group-hover:text-white/70 ml-auto flex-shrink-0"
      />
    </button>
  );
}

// Helper to format dates nicely
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Helper to get platform icon for donation
function getDonationIcon(platform: string): string {
  const lower = platform.toLowerCase();
  if (lower.includes("patreon")) return "simple-icons:patreon";
  if (lower.includes("ko-fi") || lower.includes("kofi")) return "simple-icons:kofi";
  if (lower.includes("paypal")) return "simple-icons:paypal";
  if (lower.includes("github")) return "simple-icons:github";
  if (lower.includes("bmac") || lower.includes("buymeacoffee")) return "simple-icons:buymeacoffee";
  if (lower.includes("opencollective")) return "simple-icons:opencollective";
  return "solar:heart-bold";
}


// Helper to get loader icon
function getLoaderIcon(loader: string): string {
  const lower = loader.toLowerCase();
  if (lower === "fabric") return "simple-icons:fabric";
  if (lower === "forge") return "simple-icons:curseforge"; // No dedicated forge icon, use curseforge
  if (lower === "neoforge") return "simple-icons:curseforge";
  if (lower === "quilt") return "simple-icons:quilted-fabric-api";
  return "solar:cpu-bolt-bold";
}

// Helper to format environment support
function formatSideSupport(side: string | null): { label: string; color: string } {
  switch (side) {
    case "required":
      return { label: i18n.t('mod_detail.support.required'), color: "text-green-400" };
    case "optional":
      return { label: i18n.t('mod_detail.support.optional'), color: "text-yellow-400" };
    case "unsupported":
      return { label: i18n.t('mod_detail.support.unsupported'), color: "text-red-400" };
    default:
      return { label: i18n.t('mod_detail.support.unknown'), color: "text-white/50" };
  }
}

// Helper to group and format Minecraft versions
function formatGameVersions(versions: string[]): string[] {
  if (!versions || versions.length === 0) return [];

  // Sort versions semantically (newest first)
  const sorted = [...versions].sort((a, b) => {
    const aParts = a.split('.').map(p => parseInt(p) || 0);
    const bParts = b.split('.').map(p => parseInt(p) || 0);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const diff = (bParts[i] || 0) - (aParts[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  // Group by major.minor version
  const groups = new Map<string, string[]>();
  for (const version of sorted) {
    const parts = version.split('.');
    if (parts.length >= 2) {
      const majorMinor = `${parts[0]}.${parts[1]}`;
      if (!groups.has(majorMinor)) {
        groups.set(majorMinor, []);
      }
      groups.get(majorMinor)!.push(version);
    } else {
      groups.set(version, [version]);
    }
  }

  // Format each group
  const formatted: string[] = [];
  for (const [majorMinor, groupVersions] of groups) {
    if (groupVersions.length >= 3) {
      // If 3+ versions in a group, use .x notation
      formatted.push(`${majorMinor}.x`);
    } else if (groupVersions.length === 2) {
      // For 2 versions, show range like "1.18.1–1.18.2"
      formatted.push(`${groupVersions[groupVersions.length - 1]}–${groupVersions[0]}`);
    } else {
      // Single version
      formatted.push(groupVersions[0]);
    }
  }

  return formatted;
}

export function ModDetailSidebar({ project, accentColor }: ModDetailSidebarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleOpenLicense = async () => {
    if (project.license?.url) {
      try {
        await openExternalUrl(project.license.url);
      } catch (error) {
        console.error("Failed to open URL:", error);
      }
    }
  };

  // Check if there are any links
  const hasLinks =
    project.links.issues ||
    project.links.source ||
    project.links.wiki ||
    project.links.discord ||
    project.links.website;

  const hasDonations = project.donation_urls.length > 0;
  const hasEnvironmentInfo = project.client_side || project.server_side;
  const hasCompatibilityInfo = project.game_versions.length > 0 || project.loaders.length > 0 || hasEnvironmentInfo;

  const hasDependencies = project.dependencies.length > 0;

  // Format game versions for display
  const formattedVersions = formatGameVersions(project.game_versions);

  return (
    <div className="space-y-4">
      {/* Compatibility Section */}
      {hasCompatibilityInfo && (
        <div className="bg-black/20 rounded-lg p-4 border border-white/10">
          <h3 className="text-sm font-minecraft-ten text-white/70 mb-3 uppercase flex items-center gap-2">
            <Icon icon="solar:check-circle-bold" className="w-4 h-4" />
            {t('mod_detail.compatibility')}
          </h3>

          <div className="space-y-3 text-xs font-minecraft-ten">
            {/* Minecraft Versions */}
            {formattedVersions.length > 0 && (
              <div>
                <span className="text-white/50 mb-2 block">
                  {t('mod_detail.minecraft_java')}
                </span>
                <div className="flex flex-wrap gap-1">
                  {formattedVersions.slice(0, 8).map((version) => (
                    <span
                      key={version}
                      className="px-2 py-0.5 bg-white/10 rounded text-white/80 text-[10px]"
                    >
                      {version}
                    </span>
                  ))}
                  {formattedVersions.length > 8 && (
                    <span className="px-2 py-0.5 text-white/50 text-[10px]">
                      +{formattedVersions.length - 8} {t('common.more')}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Platforms/Loaders */}
            {project.loaders.length > 0 && (
              <div>
                <span className="text-white/50 mb-2 block">
                  {t('mod_detail.platforms')}
                </span>
                <div className="flex flex-wrap gap-1">
                  {project.loaders.map((loader) => (
                    <span
                      key={loader}
                      className="px-2 py-0.5 bg-white/10 rounded text-white/80 text-[10px] capitalize flex items-center gap-1"
                    >
                      <Icon icon={getLoaderIcon(loader)} className="w-3 h-3" />
                      {loader}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Environment Support */}
            {hasEnvironmentInfo && (
              <div>
                <span className="text-white/50 mb-2 block">
                  {t('mod_detail.supported_environments')}
                </span>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-white/70 flex items-center gap-1">
                      <Icon icon="solar:monitor-bold" className="w-3 h-3" />
                      {t('content.filters.client')}
                    </span>
                    <span className={formatSideSupport(project.client_side).color}>
                      {formatSideSupport(project.client_side).label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white/70 flex items-center gap-1">
                      <Icon icon="solar:server-bold" className="w-3 h-3" />
                      {t('content.filters.server')}
                    </span>
                    <span className={formatSideSupport(project.server_side).color}>
                      {formatSideSupport(project.server_side).label}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dependencies Section */}
      {hasDependencies && (
        <div className="bg-black/20 rounded-lg p-4 border border-white/10">
          <h3 className="text-sm font-minecraft-ten text-white/70 mb-3 uppercase flex items-center gap-2">
            <Icon icon="solar:widget-add-bold" className="w-4 h-4" />
            Dependencies ({project.dependencies.length})
          </h3>

          <div className="space-y-2">
            {project.dependencies.map((dep) => (
              <button
                key={dep.project_id}
                onClick={() => navigate(`/mods/${dep.source.toLowerCase()}/${dep.project_id}`)}
                className="flex items-center gap-2 w-full text-left hover:bg-white/5 rounded-md p-1.5 -mx-1.5 transition-colors group"
              >
                {dep.icon_url ? (
                  <img
                    src={dep.icon_url}
                    alt={dep.title}
                    className="w-8 h-8 rounded object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-white/10 flex items-center justify-center flex-shrink-0">
                    <Icon icon="solar:box-bold" className="w-4 h-4 text-white/50" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-minecraft-ten text-white truncate group-hover:text-accent transition-colors block">
                    {dep.title}
                  </span>
                  <span className={`text-[10px] font-minecraft-ten ${
                    dep.dependency_type === UnifiedDependencyType.Required
                      ? 'text-red-400/80'
                      : 'text-yellow-400/80'
                  }`}>
                    {dep.dependency_type === UnifiedDependencyType.Required ? 'Required' : 'Optional'}
                  </span>
                </div>
                <Icon
                  icon="solar:arrow-right-bold"
                  className="w-3 h-3 text-white/0 group-hover:text-white/50 flex-shrink-0 transition-colors"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Team Members Section */}
      {project.team_members.length > 0 && (
        <div className="bg-black/20 rounded-lg p-4 border border-white/10">
          <h3 className="text-sm font-minecraft-ten text-white/70 mb-3 uppercase flex items-center gap-2">
            <Icon icon="solar:users-group-rounded-bold" className="w-4 h-4" />
            Team ({project.team_members.length})
          </h3>

          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {project.team_members.map((member, index) => (
              <button
                key={index}
                onClick={() => openExternalUrl(member.profile_url)}
                className="flex items-center gap-2 w-full text-left hover:bg-white/5 rounded-md p-1 -m-1 transition-colors group"
              >
                {member.avatar_url ? (
                  <img
                    src={member.avatar_url}
                    alt={member.username}
                    className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                    <Icon icon="solar:user-bold" className="w-4 h-4 text-white/50" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-minecraft-ten text-white truncate group-hover:text-accent transition-colors">{member.username}</p>
                  <p className="text-[10px] text-white/50 font-minecraft-ten truncate">{member.role}</p>
                </div>
                <Icon
                  icon="solar:arrow-right-up-bold"
                  className="w-3 h-3 text-white/0 group-hover:text-white/50 flex-shrink-0 transition-colors"
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Donate Section */}
      {hasDonations && (
        <div className="bg-black/20 rounded-lg p-4 border border-white/10">
          <h3 className="text-sm font-minecraft-ten text-white/70 mb-3 uppercase flex items-center gap-2">
            <Icon icon="solar:heart-bold" className="w-4 h-4 text-red-400" />
            {t('mod_detail.support')}
          </h3>

          <div className="space-y-2">
            {project.donation_urls.map((donation, index) => (
              <LinkItem
                key={index}
                icon={getDonationIcon(donation.platform)}
                label={donation.platform}
                url={donation.url}
              />
            ))}
          </div>
        </div>
      )}

      {/* Links Section */}
      {hasLinks && (
        <div className="bg-black/20 rounded-lg p-4 border border-white/10">
          <h3 className="text-sm font-minecraft-ten text-white/70 mb-3 uppercase flex items-center gap-2">
            <Icon icon="solar:link-bold" className="w-4 h-4" />
            {t('mod_detail.links_title')}
          </h3>

          <div className="space-y-2">
            <LinkItem
              icon="solar:globe-bold"
              label={t('mod_detail.links.website')}
              url={project.links.website}
            />
            <LinkItem
              icon="solar:code-bold"
              label={t('mod_detail.links.source_code')}
              url={project.links.source}
            />
            <LinkItem
              icon="solar:bug-bold"
              label={t('mod_detail.links.issue_tracker')}
              url={project.links.issues}
            />
            <LinkItem
              icon="solar:book-bold"
              label={t('mod_detail.links.wiki')}
              url={project.links.wiki}
            />
            <LinkItem
              icon="ic:baseline-discord"
              label={t('mod_detail.links.discord')}
              url={project.links.discord}
            />
          </div>
        </div>
      )}

      {/* Details Section */}
      <div className="bg-black/20 rounded-lg p-4 border border-white/10">
        <h3 className="text-sm font-minecraft-ten text-white/70 mb-3 uppercase flex items-center gap-2">
          <Icon icon="solar:info-circle-bold" className="w-4 h-4" />
          {t('mod_detail.details')}
        </h3>

        <div className="space-y-3 text-xs font-minecraft-ten">
          {/* License */}
          {project.license && (
            <div className="flex justify-between items-center">
              <span className="text-white/50">{t('mod_detail.license')}</span>
              {project.license.url ? (
                <button
                  onClick={handleOpenLicense}
                  className="text-accent hover:text-accent/80 transition-colors"
                >
                  {project.license.name}
                </button>
              ) : (
                <span className="text-white/90">{project.license.name}</span>
              )}
            </div>
          )}

          {/* Dates */}
          <div className="flex justify-between">
            <span className="text-white/50">{t('mod_detail.created')}</span>
            <span className="text-white/90">{formatDate(project.date_created)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/50">{t('mod_detail.updated')}</span>
            <span className="text-white/90">{formatDate(project.date_modified)}</span>
          </div>

          {/* Project Info */}
          <div className="border-t border-white/10 pt-3 mt-3">
            <div className="flex justify-between">
              <span className="text-white/50">{t('mod_detail.project_id')}</span>
              <span className="text-white/70 font-mono text-[10px]">{project.id}</span>
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-white/50">{t('mod_detail.type')}</span>
              <span className="text-white/90 capitalize">{project.project_type}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
