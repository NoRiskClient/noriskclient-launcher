"use client";

import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Modal } from "../ui/Modal";
import { Icon } from "@iconify/react";
import { Button } from "../ui/buttons/Button";
import type { UnifiedModpackVersionsResponse, UnifiedVersion } from "../../types/unified";
import { UnifiedVersionType } from "../../types/unified";
import UnifiedService from "../../services/unified-service";
import * as ProfileService from "../../services/profile-service";
import { toast } from "react-hot-toast";
import { parseErrorMessage } from "../../utils/error-utils";
import { sanitizeRichHtml } from "../../utils/html-sanitize";
import { useModalScope } from "../ui/ModalScope";
import { isTopDialog } from "../ui/modal-focus";

interface ModpackVersionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  versions: UnifiedModpackVersionsResponse | null;
  modpackName: string;
  profileId?: string;
  onVersionSwitch?: (version: UnifiedVersion) => void | Promise<void>;
  onSwitchComplete?: () => void | Promise<void>;
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
      return "solar:test-tube-bold";
    default:
      return "solar:tag-bold";
  }
}

function formatDate(dateString: string, language: string): string {
  return new Date(dateString).toLocaleDateString(language, {
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
  isDisabled = false,
  onSelect
}: {
  version: UnifiedVersion;
  isInstalled: boolean;
  isSelected: boolean;
  isDisabled?: boolean;
  onSelect: (version: UnifiedVersion) => void;
}) {
  const { t, i18n } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [curseforgeChangelog, setCurseforgeChangelog] = useState<string | null>(null);
  const [isLoadingChangelog, setIsLoadingChangelog] = useState(false);
  const [changelogError, setChangelogError] = useState<string | null>(null);
  const modalOwner = useModalScope();
  const changelogPendingRef = useRef(false);
  const changelogMountedRef = useRef(true);

  React.useEffect(() => {
    changelogMountedRef.current = true;
    return () => { changelogMountedRef.current = false; };
  }, []);

  const handleClick = () => {
    if (!isInstalled && !isDisabled) {
      onSelect(version);
    }
  };

  const reserveChangelogFocus = (trigger: HTMLButtonElement) => {
    const panel = trigger.closest<HTMLElement>("[data-modal-id]");
    if (trigger.ownerDocument.activeElement !== trigger || !trigger.isConnected ||
      !panel?.isConnected || !modalOwner || panel.dataset.modalId !== modalOwner ||
      !isTopDialog(panel) || trigger.closest('[inert], [hidden], [aria-hidden="true"]') ||
      panel.closest('[inert], [hidden], [aria-hidden="true"]')) return;
    // The real panel survives native disable and Retry removal. Completion
    // never overrides a connected focus destination chosen elsewhere.
    panel.focus({ preventScroll: true });
  };

  const loadCurseforgeChangelog = async (trigger: HTMLButtonElement) => {
    if (changelogPendingRef.current || version.source !== "CurseForge" ||
      version.changelog || curseforgeChangelog !== null) return;
    changelogPendingRef.current = true;
    reserveChangelogFocus(trigger);
    setIsLoadingChangelog(true);
    setChangelogError(null);
    try {
      const changelog = await UnifiedService.getCurseForgeFileChangelog(
        parseInt(version.project_id),
        parseInt(version.id)
      );
      if (changelogMountedRef.current) setCurseforgeChangelog(changelog);
    } catch (error) {
      if (changelogMountedRef.current) {
        console.error("Failed to load CurseForge changelog:", error);
        setChangelogError(parseErrorMessage(error));
      }
    } finally {
      changelogPendingRef.current = false;
      if (changelogMountedRef.current) setIsLoadingChangelog(false);
    }
  };

  const toggleExpanded = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (changelogPendingRef.current) return;
    setIsExpanded(!isExpanded);
    // A rejected GET stays rejected until the explicit Retry is activated.
    if (!isExpanded && changelogError === null) void loadCurseforgeChangelog(e.currentTarget);
  };

  const retryChangelog = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    void loadCurseforgeChangelog(e.currentTarget);
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
      <div className="absolute top-2 right-2 flex items-center space-x-1 text-xs text-white/50 font-minecraft">
        <span>{formatDownloads(version.downloads)}</span>
        <span>{formatDate(version.date_published, i18n.resolvedLanguage || i18n.language)}</span>
      </div>

      {/* Hauptinhalt */}
      <div className="flex items-center justify-between pr-20">
        <div className="flex-1 min-w-0">
          {/* Name und Version in einer Zeile */}
          <div className="flex items-center gap-2 mb-1">
            <button
              type="button"
              className="text-white font-minecraft text-sm font-medium truncate focus-visible:[outline-style:solid] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/30"
              aria-label={t('modpack_versions.select_version', { name: version.name, version: version.version_number })}
              aria-pressed={isSelected && !isInstalled}
              disabled={isInstalled || isDisabled}
              onClick={(e) => { e.stopPropagation(); handleClick(); }}
            >
              {version.version_number}
            </button>
            {isInstalled && (
              <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded font-minecraft uppercase">
                {t('modpack_versions.current')}
              </span>
            )}
          </div>

          {/* MC Versionen */}
          <div className="text-xs text-white/60 font-minecraft">
            MC: {version.game_versions.slice(0, 2).join(', ')}
            {version.game_versions.length > 2 && ` +${version.game_versions.length - 2}`}
          </div>

          {/* Changelog Button */}
          {(version.changelog || version.source === "CurseForge") && (
            <button
              type="button"
              onClick={toggleExpanded}
              className="mt-1 flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-white/10 transition-colors font-minecraft border border-white/20 focus-visible:[outline-style:solid] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/30"
              title={isExpanded ? t('modpack_versions.hide_changelog') : t('modpack_versions.show_changelog')}
              aria-expanded={isExpanded}
              aria-busy={isLoadingChangelog}
              disabled={isLoadingChangelog}
            >
              {isLoadingChangelog ? (
                <Icon icon="svg-spinners:ring-resize" className="w-3 h-3" />
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
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="text-xs font-minecraft text-white/70 mb-2 uppercase">
            {t('modpack_versions.changelog')}
          </div>
          <div className="max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
            {isLoadingChangelog ? (
              <div role="status" className="flex items-center justify-center py-4">
                <Icon icon="svg-spinners:ring-resize" className="w-5 h-5 text-white/50" aria-hidden="true" />
                <span className="ml-2 text-sm text-white/50 font-minecraft">{t('modpack_versions.loading_changelog')}</span>
              </div>
            ) : changelogError !== null ? (
              <div role="alert" className="text-sm text-red-300 font-minecraft break-words">
                <p>{t('modpack_versions.load_changelog_error', { error: changelogError })}</p>
                <button
                  type="button"
                  onClick={retryChangelog}
                  disabled={isLoadingChangelog}
                  className="mt-2 flex items-center gap-1 px-2 py-1 rounded text-xs text-white/80 hover:bg-white/10 transition-colors font-minecraft border border-white/20 focus-visible:[outline-style:solid] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white/30"
                >
                  {t('modpack_versions.retry_changelog')}
                </button>
              </div>
            ) : displayChangelog ? (
              version.source === "CurseForge" ? (
                // Render HTML for CurseForge (sanitized)
                <div
                  className="prose prose-invert prose-sm max-w-none font-minecraft [&_*]:text-white [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:first:mt-0 [&_h2]:text-base [&_h2]:font-bold [&_h2]:mb-2 [&_h2]:mt-3 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:mb-1 [&_h3]:mt-2 [&_p]:text-sm [&_p]:text-white/90 [&_p]:mb-2 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:list-inside [&_ul]:text-sm [&_ul]:text-white/90 [&_ul]:mb-2 [&_ul]:space-y-1 [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:list-inside [&_ol]:text-sm [&_ol]:text-white/90 [&_ol]:mb-2 [&_ol]:space-y-1 [&_ol]:ml-4 [&_li]:leading-relaxed [&_strong]:font-bold [&_strong]:text-white [&_em]:italic [&_em]:text-white/80 [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_code]:text-white/90 [&_pre]:bg-black/30 [&_pre]:p-2 [&_pre]:rounded [&_pre]:text-xs [&_pre]:font-mono [&_pre]:text-white/90 [&_pre]:overflow-x-auto [&_pre]:mb-2 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-white/70 [&_blockquote]:my-2 [&_a]:text-accent [&_a]:hover:text-accent/80 [&_a]:underline"
                  dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(displayChangelog) }}
                />
              ) : (
                // Render Markdown for Modrinth
                <div className="prose prose-invert prose-sm max-w-none font-minecraft">
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
              <div className="text-sm text-white/50 font-minecraft text-center py-4">
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
  const [versions, setVersions] = useState<UnifiedModpackVersionsResponse | null>(initialVersions);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<UnifiedVersion | null>(null);
  const [isSwitchingLocally, setIsSwitchingLocally] = useState(false);
  const switchingRef = useRef(false);
  const isBusy = isSwitching || isSwitchingLocally;

  // Load fresh versions when modal opens by loading the current profile
  React.useEffect(() => {
    let cancelled = false;
    if (isOpen && profileId) {
      setIsLoadingVersions(true);
      setSelectedVersion(null);

      console.log("Loading modpack versions for profile:", profileId);
      console.log("Initial versions:", initialVersions);

      // Load the current profile to get the latest modpack source
      ProfileService.getProfile(profileId)
        .then(profile => {
          if (cancelled) return null;
          if (profile.modpack_info?.source) {
            return UnifiedService.getModpackVersions(profile.modpack_info.source);
          } else {
            throw new Error("No modpack source found in profile");
          }
        })
        .then(versions => {
          if (cancelled || !versions) return;
          console.log("Loaded modpack versions:", versions);
          console.log("First version has changelog:", versions.all_versions[0]?.changelog);

          // Keep provider changelogs unchanged; absent backend data stays absent.

          setVersions(versions);
        })
        .catch(err => {
          if (cancelled) return;
          console.error("Failed to load fresh modpack versions:", err);
          setVersions(initialVersions); // fallback to initial versions
        })
        .finally(() => { if (!cancelled) setIsLoadingVersions(false); });
    } else {
      setIsLoadingVersions(false);
    }
    return () => { cancelled = true; };
  }, [isOpen, profileId, initialVersions]);

  // Reset when modal closes
  React.useEffect(() => {
    if (!isOpen) {
      setVersions(initialVersions);
      setSelectedVersion(null);
    }
  }, [isOpen, initialVersions]);

  // A refreshed list may no longer contain the selection, or may mark it installed.
  React.useEffect(() => {
    setSelectedVersion(current => {
      if (!current || !versions) return null;
      const next = versions.all_versions.find(v =>
        v.id === current.id && v.project_id === current.project_id && v.source === current.source,
      );
      const installed = versions.installed_version;
      return !next || (installed?.id === next.id && installed.project_id === next.project_id && installed.source === next.source)
        ? null : next;
    });
  }, [versions]);

  if (!isOpen || !versions) {
    return null;
  }

  // Sort versions by date (newest first)
  const sortedVersions = [...versions.all_versions].sort(
    (a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime()
  );

  const installedVersionId = versions.installed_version?.id;

  const handleVersionSelect = (version: UnifiedVersion) => {
    if (switchingRef.current || isBusy || isLoadingVersions) return;
    // Don't allow selecting already installed version
    if (version.id === installedVersionId) return;
    setSelectedVersion(version);
  };

  const handleSwitchVersion = async () => {
    if (!selectedVersion || switchingRef.current || isBusy || isLoadingVersions) return;
    switchingRef.current = true;
    setIsSwitchingLocally(true);
    let loadingToast: string | undefined;
    try {
      const version = versions.all_versions.find(v =>
        v.id === selectedVersion.id && v.project_id === selectedVersion.project_id && v.source === selectedVersion.source,
      );
      if (!version || version.id === installedVersionId) throw new Error("Selected modpack version is no longer available");
      if (profileId) {
        // A known profile always uses the native contract; missing files are errors, not legacy fallbacks.
        const request = UnifiedService.buildModpackSwitchRequest(profileId, version);
        loadingToast = toast.loading(t('modpack_versions.toast.switching', { name: modpackName, version: version.version_number }));
        await UnifiedService.switchModpackVersion(request);
        setSelectedVersion(null);
        setVersions(current => current ? { ...current, installed_version: version } : current);
        toast.dismiss(loadingToast);
        loadingToast = undefined;
        toast.success(t('modpack_versions.toast.switch_success', { name: modpackName, version: version.version_number }));
        // Installation succeeded. A refresh failure must not invite a second installation.
        if (onSwitchComplete) {
          try { await onSwitchComplete(); }
          catch (error) {
            toast.error(t('modpack_versions.toast.refresh_failed', { name: modpackName, version: version.version_number, error: parseErrorMessage(error) }));
          }
        }
        onClose();
      } else if (onVersionSwitch) {
        await onVersionSwitch(version);
      } else {
        throw new Error("No modpack switch handler available");
      }
    } catch (error) {
      toast.error(t('modpack_versions.toast.switch_failed', { error: parseErrorMessage(error) }));
    } finally {
      if (loadingToast !== undefined) toast.dismiss(loadingToast);
      switchingRef.current = false;
      setIsSwitchingLocally(false);
    }
  };

  const handleClose = () => {
    if (!switchingRef.current && !isSwitching) onClose();
  };

  return (
    <Modal
      title={t('modpack_versions.title', { name: modpackName })}
      titleIcon={<Icon icon="solar:archive-bold" className="w-6 h-6 text-blue-400" />}
      onClose={handleClose}
      closeOnClickOutside={!isBusy}
      closeOnEscape={!isBusy}
      hideCloseButton={isBusy}
      width="lg"
      className="max-h-[80vh]"
      footer={
        <div className="flex justify-end items-center gap-3">
          <Button
            variant="secondary"
            onClick={handleClose}
            disabled={isBusy}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="default"
            onClick={handleSwitchVersion}
            disabled={!selectedVersion || isBusy || isLoadingVersions}
            icon={isBusy ? <Icon icon="svg-spinners:ring-resize" className="h-4 w-4" /> : <Icon icon="solar:refresh-circle-bold" className="h-4 w-4" />}
          >
            {isBusy ? t('modpack_versions.button.switching') : selectedVersion ? t('modpack_versions.button.switch_version') : t('modpack_versions.button.select_version')}
          </Button>
        </div>
      }
    >
      <div className="p-4">
        <div className="mb-4 text-sm text-white/70 font-minecraft">
          {isLoadingVersions ? (
            t('modpack_versions.loading')
          ) : (
            <>
              {t('modpack_versions.available', { count: versions.all_versions.length })}
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
              className="text-xs font-minecraft text-center font-medium mb-1"
              style={{ color: `var(--accent)` }}
            >
              {t('modpack_versions.selected', { name: selectedVersion.name, version: selectedVersion.version_number })}
            </div>
          </div>
        ) : (
          <div className="mb-4 text-xs text-white/50 font-minecraft text-center">
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
              isDisabled={isBusy || isLoadingVersions}
              onSelect={handleVersionSelect}
            />
          ))}
        </div>

        {sortedVersions.length === 0 && (
          <div className="text-center py-8 text-white/50 font-minecraft">
            {t('modpack_versions.no_versions')}
          </div>
        )}
      </div>
    </Modal>
  );
}
