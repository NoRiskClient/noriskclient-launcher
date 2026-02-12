"use client";

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Modal } from "../ui/Modal";
import { Icon } from "@iconify/react";
import { Button } from "../ui/buttons/Button";
import type { UnifiedModpackVersionsResponse, UnifiedVersion, ModpackSwitchRequest } from "../../types/unified";
import { UnifiedVersionType } from "../../types/unified";
import type { ModPackSource } from "../../types/profile";
import UnifiedService from "../../services/unified-service";
import * as ProfileService from "../../services/profile-service";
import { toast } from "react-hot-toast";

// HTML sanitizer for CurseForge HTML content
const sanitizeHtml = (html: string) => {
  // Basic HTML sanitization - remove potentially dangerous tags
  return html
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<style[^>]*>.*?<\/style>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+="[^"]*"/gi, '');
};

interface ModpackVersionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  versions: UnifiedModpackVersionsResponse | null;
  modpackName: string;
  profileId?: string;
  onVersionSwitch?: (version: UnifiedVersion) => void;
  onSwitchComplete?: () => void;
  isSwitching?: boolean;
}

function getVersionTypeColor(type: UnifiedVersionType): string {
  switch (type) {
    case UnifiedVersionType.Release:
      return "text-green-400";
    case UnifiedVersionType.Beta:
      return "text-yellow-400";
    case UnifiedVersionType.Alpha:
      return "text-red-400";
    default:
      return "text-gray-400";
  }
}

function getVersionTypeIcon(type: UnifiedVersionType): string {
  switch (type) {
    case UnifiedVersionType.Release:
      return "solar:tag-bold";
    case UnifiedVersionType.Beta:
      return "solar:test-tube-bold";
    case UnifiedVersionType.Alpha:
      return "solar:flask-bold";
    default:
      return "solar:tag-bold";
  }
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function formatDownloads(downloads: number): string {
  if (downloads >= 1000000) {
    return `${(downloads / 1000000).toFixed(1)}M`;
  }
  if (downloads >= 1000) {
    return `${(downloads / 1000).toFixed(1)}K`;
  }
  return downloads.toString();
}

function VersionItem({
  version,
  isInstalled,
  isSelected,
  onSelect
}: {
  version: UnifiedVersion;
  isInstalled: boolean;
  isSelected: boolean;
  onSelect: (version: UnifiedVersion) => void;
}) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [curseforgeChangelog, setCurseforgeChangelog] = useState<string | null>(null);
  const [isLoadingChangelog, setIsLoadingChangelog] = useState(false);

  const handleClick = () => {
    if (!isInstalled) {
      onSelect(version);
    }
  };

  const toggleExpanded = async (e: React.MouseEvent) => {
    e.stopPropagation();

    // If expanding and it's a CurseForge version without changelog loaded, load it
    if (!isExpanded && version.source === "CurseForge" && !version.changelog && !curseforgeChangelog) {
      setIsLoadingChangelog(true);
      try {
        const changelog = await UnifiedService.getCurseForgeFileChangelog(
          parseInt(version.project_id),
          parseInt(version.id)
        );
        setCurseforgeChangelog(changelog);
      } catch (error) {
        console.error("Failed to load CurseForge changelog:", error);
        setCurseforgeChangelog(""); // Empty string to prevent retrying
      } finally {
        setIsLoadingChangelog(false);
      }
    }

    setIsExpanded(!isExpanded);
  };

  // Determine which changelog to show
  const displayChangelog = version.changelog || curseforgeChangelog;

  return (
    <div
      className={`relative p-3 rounded-lg border transition-all duration-200 ${
        isInstalled
          ? "bg-black/30 border-white/30 cursor-not-allowed"
          : isSelected
          ? "border-white/30 cursor-pointer"
          : "bg-black/20 border-white/10 hover:bg-black/30 hover:border-white/20 cursor-pointer"
      }`}
      style={isSelected && !isInstalled ? {
        backgroundColor: `rgba(var(--accent-rgb), 0.15)`,
        borderColor: `var(--accent)`
      } : undefined}
      onClick={handleClick}
    >
      {/* Stats - oben rechts */}
      <div className="absolute top-2 right-2 flex items-center space-x-1 text-xs text-white/50 font-minecraft-ten">
        <span>{formatDownloads(version.downloads)}</span>
        <span>{formatDate(version.date_published)}</span>
      </div>

      {/* Hauptinhalt */}
      <div className="flex items-center justify-between pr-20">
        <div className="flex-1 min-w-0">
          {/* Name und Version in einer Zeile */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-white font-minecraft-ten text-sm font-medium truncate">
              {version.version_number}
            </span>
            {isInstalled && (
              <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded font-minecraft-ten uppercase">
                {t('modpack_versions.current')}
              </span>
            )}
          </div>

          {/* MC Versionen */}
          <div className="text-xs text-white/60 font-minecraft-ten">
            MC: {version.game_versions.slice(0, 2).join(', ')}
            {version.game_versions.length > 2 && ` +${version.game_versions.length - 2}`}
          </div>

          {/* Changelog Button */}
          {(version.changelog || version.source === "CurseForge") && (
            <button
              onClick={toggleExpanded}
              className="mt-1 flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-white/10 transition-colors font-minecraft-ten border border-white/20"
              title={isExpanded ? "Hide changelog" : "Show changelog"}
              disabled={isLoadingChangelog}
            >
              {isLoadingChangelog ? (
                <Icon icon="solar:refresh-circle-bold" className="w-3 h-3 animate-spin" />
              ) : (
                <Icon
                  icon={isExpanded ? "solar:alt-arrow-up-bold" : "solar:alt-arrow-down-bold"}
                  className="w-3 h-3"
                />
              )}
              <span className="text-white/70">
                {isLoadingChangelog ? t('common.loading') : t('modpack_versions.changelog')}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Changelog Bereich */}
      {isExpanded && displayChangelog && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="text-xs font-minecraft-ten text-white/70 mb-2 uppercase">
            {t('modpack_versions.changelog')}
          </div>
          <div className="max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
            {isLoadingChangelog ? (
              <div className="flex items-center justify-center py-4">
                <Icon icon="solar:refresh-circle-bold" className="w-5 h-5 animate-spin text-white/50" />
                <span className="ml-2 text-sm text-white/50 font-minecraft-ten">{t('modpack_versions.loading_changelog')}</span>
              </div>
            ) : displayChangelog ? (
              version.source === "CurseForge" ? (
                // Render HTML for CurseForge (sanitized)
                <div
                  className="prose prose-invert prose-sm max-w-none font-minecraft-ten [&_*]:text-white [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:first:mt-0 [&_h2]:text-base [&_h2]:font-bold [&_h2]:mb-2 [&_h2]:mt-3 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:mb-1 [&_h3]:mt-2 [&_p]:text-sm [&_p]:text-white/90 [&_p]:mb-2 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:list-inside [&_ul]:text-sm [&_ul]:text-white/90 [&_ul]:mb-2 [&_ul]:space-y-1 [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:list-inside [&_ol]:text-sm [&_ol]:text-white/90 [&_ol]:mb-2 [&_ol]:space-y-1 [&_ol]:ml-4 [&_li]:leading-relaxed [&_strong]:font-bold [&_strong]:text-white [&_em]:italic [&_em]:text-white/80 [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_code]:text-white/90 [&_pre]:bg-black/30 [&_pre]:p-2 [&_pre]:rounded [&_pre]:text-xs [&_pre]:font-mono [&_pre]:text-white/90 [&_pre]:overflow-x-auto [&_pre]:mb-2 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-white/70 [&_blockquote]:my-2 [&_a]:text-accent [&_a]:hover:text-accent/80 [&_a]:underline"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(displayChangelog) }}
                />
              ) : (
                // Render Markdown for Modrinth
                <div className="prose prose-invert prose-sm max-w-none font-minecraft-ten">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ children }) => <h1 className="text-lg font-bold text-white mb-2 mt-4 first:mt-0">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-base font-bold text-white mb-2 mt-3">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-sm font-bold text-white mb-1 mt-2">{children}</h3>,
                      p: ({ children }) => <p className="text-sm text-white/90 mb-2 leading-relaxed">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc list-inside text-sm text-white/90 mb-2 space-y-1 ml-4">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside text-sm text-white/90 mb-2 space-y-1 ml-4">{children}</ol>,
                      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                      strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
                      em: ({ children }) => <em className="italic text-white/80">{children}</em>,
                      code: ({ children }) => <code className="bg-black/30 px-1 py-0.5 rounded text-xs font-mono text-white/90">{children}</code>,
                      pre: ({ children }) => <pre className="bg-black/30 p-2 rounded text-xs font-mono text-white/90 overflow-x-auto mb-2">{children}</pre>,
                      blockquote: ({ children }) => <blockquote className="border-l-2 border-accent pl-3 italic text-white/70 my-2">{children}</blockquote>,
                      a: ({ href, children }) => <a href={href} className="text-accent hover:text-accent/80 underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                      table: ({ children }) => (
                        <div className="overflow-x-auto mb-2">
                          <table className="w-full border-collapse text-sm">{children}</table>
                        </div>
                      ),
                      thead: ({ children }) => <thead className="bg-black/30">{children}</thead>,
                      tbody: ({ children }) => <tbody>{children}</tbody>,
                      tr: ({ children }) => <tr className="border-b border-white/10 hover:bg-white/5">{children}</tr>,
                      th: ({ children }) => <th className="p-2 border border-white/20 text-left font-semibold text-white/90">{children}</th>,
                      td: ({ children }) => <td className="p-2 border border-white/20 text-white/80">{children}</td>,
                    }}
                  >
                    {displayChangelog}
                  </ReactMarkdown>
                </div>
              )
            ) : (
              <div className="text-sm text-white/50 font-minecraft-ten text-center py-4">
                {t('modpack_versions.no_changelog')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ModpackVersionsModal({
  isOpen,
  onClose,
  versions: initialVersions,
  modpackName,
  profileId,
  onVersionSwitch,
  onSwitchComplete,
  isSwitching = false,
}: ModpackVersionsModalProps) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<UnifiedModpackVersionsResponse | null>(() => {
    // DEBUG: Add mock changelogs to initial versions for testing with Markdown (only for Modrinth)
    if (initialVersions && initialVersions.all_versions.length > 0) {
      initialVersions.all_versions.forEach((version, index) => {
        if (!version.changelog && version.source === "Modrinth") {
          const mockChangelogs = [
            `### Version ${version.version_number}

**An actually working version of ${version.version_number}, sorry about last time.** No changes to anything except for the pack format, same mods and fabric version as last time.

> ### Status Update
> I've been working on new tooling for Sodium Plus for a long time now. I'm in the middle of migrating some of my infrastructure to a new system, so it may be a while. In the future, these tools will allow us to update and work on Sodium Plus a lot more quickly and with much higher quality. It is important that I finish this. In the meantime, @NoSadBeHappy will be updating the pack with smaller fixes and alpha versions to support Minecraft updates. Thank you for your patience!
> - RedstoneWizard08

#### Changes:
- Fixed compatibility with Minecraft ${version.game_versions[0] || 'latest'}
- Updated mod dependencies
- Performance improvements`,
            `## What's New in ${version.version_number}

### ✨ Features
- Added new shader support
- Improved graphics settings
- Enhanced mod compatibility

### 🐛 Bug Fixes
- Fixed crash on startup
- Resolved memory leaks
- Corrected texture rendering issues

### 🔧 Technical
- Updated to Fabric ${version.loaders.includes('fabric') ? 'latest' : 'compatible'} version
- Optimized resource loading
- Better error handling`,
            `# Changelog for ${version.version_number}

This release focuses on stability and performance improvements.

**Key Changes:**
- **Performance**: Significant FPS improvements in heavy modpacks
- **Compatibility**: Better support for Minecraft ${version.game_versions[0] || 'various versions'}
- **Bug Fixes**: Various crash fixes and stability improvements

> **Note**: This version requires Java 17 or higher for optimal performance.`
          ];
          version.changelog = mockChangelogs[index % mockChangelogs.length];
        }
      });
    }
    return initialVersions;
  });
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);

  // Load fresh versions when modal opens by loading the current profile
  React.useEffect(() => {
    if (isOpen && profileId) {
      setIsLoadingVersions(true);

      console.log("Loading modpack versions for profile:", profileId);
      console.log("Initial versions:", initialVersions);

      // Load the current profile to get the latest modpack source
      ProfileService.getProfile(profileId)
        .then(profile => {
          if (profile.modpack_info?.source) {
            return UnifiedService.getModpackVersions(profile.modpack_info.source);
          } else {
            throw new Error("No modpack source found in profile");
          }
        })
        .then(versions => {
          console.log("Loaded modpack versions:", versions);
          console.log("First version has changelog:", versions.all_versions[0]?.changelog);

          // Only add mock changelogs for Modrinth versions (CurseForge will be lazy loaded)
          if (versions && versions.all_versions.length > 0) {
            versions.all_versions.forEach((version, index) => {
              if (!version.changelog && version.source === "Modrinth") {
                const mockChangelogs = [
                  `### Version ${version.version_number}

**An actually working version of ${version.version_number}, sorry about last time.** No changes to anything except for the pack format, same mods and fabric version as last time.

> ### Status Update
> I've been working on new tooling for Sodium Plus for a long time now. I'm in the middle of migrating some of my infrastructure to a new system, so it may be a while. In the future, these tools will allow us to update and work on Sodium Plus a lot more quickly and with much higher quality. It is important that I finish this. In the meantime, @NoSadBeHappy will be updating the pack with smaller fixes and alpha versions to support Minecraft updates. Thank you for your patience!
> - RedstoneWizard08

#### Changes:
- Fixed compatibility with Minecraft ${version.game_versions[0] || 'latest'}
- Updated mod dependencies
- Performance improvements`,
                  `## What's New in ${version.version_number}

### ✨ Features
- Added new shader support
- Improved graphics settings
- Enhanced mod compatibility

### 🐛 Bug Fixes
- Fixed crash on startup
- Resolved memory leaks
- Corrected texture rendering issues

### 🔧 Technical
- Updated to Fabric ${version.loaders.includes('fabric') ? 'latest' : 'compatible'} version
- Optimized resource loading
- Better error handling`,
                  `# Changelog for ${version.version_number}

This release focuses on stability and performance improvements.

**Key Changes:**
- **Performance**: Significant FPS improvements in heavy modpacks
- **Compatibility**: Better support for Minecraft ${version.game_versions[0] || 'various versions'}
- **Bug Fixes**: Various crash fixes and stability improvements

> **Note**: This version requires Java 17 or higher for optimal performance.`
                ];
                version.changelog = mockChangelogs[index % mockChangelogs.length];
              }
            });
          }

          setVersions(versions);
        })
        .catch(err => {
          console.error("Failed to load fresh modpack versions:", err);
          setVersions(initialVersions); // fallback to initial versions
        })
        .finally(() => setIsLoadingVersions(false));
    }
  }, [isOpen, profileId, initialVersions]);

  // Reset when modal closes
  React.useEffect(() => {
    if (!isOpen) {
      setVersions(initialVersions);
      setSelectedVersion(null);
    }
  }, [isOpen, initialVersions]);

  if (!isOpen || !versions) {
    return null;
  }

  // Sort versions by date (newest first)
  const sortedVersions = [...versions.all_versions].sort(
    (a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime()
  );

  const installedVersionId = versions.installed_version?.id;
  const [selectedVersion, setSelectedVersion] = useState<UnifiedVersion | null>(null);

  const handleVersionSelect = (version: UnifiedVersion) => {
    // Don't allow selecting already installed version
    if (version.id === installedVersionId) return;
    setSelectedVersion(version);
  };

  const handleSwitchVersion = async () => {
    if (!selectedVersion) return;

    // Check if we have all required information for the new modpack switching
    if (profileId && selectedVersion.files.length > 0) {
      try {
        // Find the primary file
        const primaryFile = selectedVersion.files.find(f => f.primary) || selectedVersion.files[0];

        // Create new ModPackSource based on selected version
        let newModpackSource: ModPackSource;
        if (selectedVersion.source === "Modrinth") {
          newModpackSource = {
            source: "modrinth",
            project_id: selectedVersion.project_id,
            version_id: selectedVersion.id,
          };
        } else if (selectedVersion.source === "CurseForge") {
          // For CurseForge, we need the file_id from the primary file
          const fileId = primaryFile.fingerprint; // CurseForge uses fingerprint as file_id
          if (!fileId) {
            throw new Error("CurseForge file fingerprint (file_id) not found");
          }
          newModpackSource = {
            source: "curse_forge",
            project_id: parseInt(selectedVersion.project_id), // CurseForge project_id is number
            file_id: fileId,
          };
        } else {
          throw new Error(`Unsupported modpack source: ${selectedVersion.source}`);
        }

        const request: ModpackSwitchRequest = {
          download_url: primaryFile.url,
          modpack_source: newModpackSource,
          profile_id: profileId,
        };

        // Show loading toast
        const loadingToast = toast.loading(t('modpack_versions.toast.switching', { name: modpackName, version: selectedVersion.version_number }));

        await UnifiedService.switchModpackVersion(request);

        // Dismiss loading toast and show success
        toast.dismiss(loadingToast);
        toast.success(t('modpack_versions.toast.switch_success', { name: modpackName, version: selectedVersion.version_number }));

        // Don't refresh here - let parent components handle the refresh

        // Call completion callback if provided (wait for parent components to update their state)
        if (onSwitchComplete) {
          await onSwitchComplete();
        }

        // Close modal after parent states are updated
        onClose();

      } catch (error) {
        toast.error(t('modpack_versions.toast.switch_failed', { error: String(error) }));
      }
    } else if (onVersionSwitch) {
      // Fallback to old method if we don't have all required info
      onVersionSwitch(selectedVersion);
    }
  };

  // Reset selection when modal closes
  React.useEffect(() => {
    if (!isOpen) {
      setSelectedVersion(null);
    }
  }, [isOpen]);

  return (
    <Modal
      title={t('modpack_versions.title', { name: modpackName })}
      titleIcon={<Icon icon="solar:archive-bold" className="w-6 h-6 text-blue-400" />}
      onClose={onClose}
      width="lg"
      className="max-h-[80vh]"
      footer={
        <div className="flex justify-end items-center gap-3">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isSwitching}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="default"
            onClick={handleSwitchVersion}
            disabled={!selectedVersion || isSwitching}
            icon={isSwitching ? <Icon icon="solar:refresh-bold" className="animate-spin h-4 w-4" /> : <Icon icon="solar:refresh-circle-bold" className="h-4 w-4" />}
          >
            {isSwitching ? t('modpack_versions.button.switching') : selectedVersion ? t('modpack_versions.button.switch_version') : t('modpack_versions.button.select_version')}
          </Button>
        </div>
      }
    >
      <div className="p-4">
        <div className="mb-4 text-sm text-white/70 font-minecraft-ten">
          {isLoadingVersions ? (
            t('modpack_versions.loading')
          ) : (
            <>
              {versions.all_versions.length} version{versions.all_versions.length !== 1 ? 's' : ''} available
              {versions.updates_available && (
                <span className="ml-2 text-green-400">
                  {t('modpack_versions.updates_available')}
                </span>
              )}
            </>
          )}
        </div>

        {selectedVersion ? (
          <div className="mb-4">
            <div
              className="text-xs font-minecraft-ten text-center font-medium mb-1"
              style={{ color: `var(--accent)` }}
            >
              Selected: {selectedVersion.name} ({selectedVersion.version_number})
            </div>
          </div>
        ) : (
          <div className="mb-4 text-xs text-white/50 font-minecraft-ten text-center">
            {t('modpack_versions.select_hint')}
          </div>
        )}

        <div className="space-y-4">
          {sortedVersions.map((version) => (
            <VersionItem
              key={version.id}
              version={version}
              isInstalled={version.id === installedVersionId}
              isSelected={selectedVersion?.id === version.id}
              onSelect={handleVersionSelect}
            />
          ))}
        </div>

        {sortedVersions.length === 0 && (
          <div className="text-center py-8 text-white/50 font-minecraft-ten">
            {t('modpack_versions.no_versions')}
          </div>
        )}
      </div>
    </Modal>
  );
}
