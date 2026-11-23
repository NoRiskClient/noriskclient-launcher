import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Modal } from "../ui/Modal";
import { Icon } from "@iconify/react";
import { Button } from "../ui/buttons/Button";
import type { UnifiedModpackVersionsResponse, UnifiedVersion, ModpackSwitchRequest } from "../../types/unified";
import type { ModPackSource } from "../../types/profile";
import UnifiedService from "../../services/unified-service";
import * as ProfileService from "../../services/profile-service";
import { toast } from "react-hot-toast";
import { parseErrorMessage } from "../../utils/error-utils";
import { sanitizeRichHtml } from "../../utils/html-sanitize";
import { formatCompactNumber } from "../../utils/format-number";
import { formatShortAge } from "../../utils/format-relative-time";
import { ChannelBadge } from "../mods/ChannelBadge";
import { GameVersionPill } from "../mods/GameVersionPill";
import { shortModpackVersion } from "../../utils/modpack-version";
import { cn } from "../../lib/utils";
import { logError } from "../../utils/logging-utils";
import { useLatest } from "../../hooks/useLatest";
import { PLAIN_TEXT } from "../ui/typography";

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

const VERSION_COLS = "grid grid-cols-[minmax(0,1fr)_minmax(0,7rem)_3rem_3.75rem_2rem] items-center gap-3";

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

  const displayChangelog = version.changelog || curseforgeChangelog;

  return (
    <div className="border-b border-white/5 last:border-b-0">
      <div
        onClick={handleClick}
        className={cn(
          `${VERSION_COLS} px-4 py-2.5 transition-colors select-none`,
          isInstalled ? "cursor-default" : "cursor-pointer",
          !isSelected && !isInstalled && "hover:bg-white/[0.03]",
        )}
        style={isSelected && !isInstalled ? { backgroundColor: "rgba(var(--accent-rgb), 0.15)" } : undefined}
      >
        <span className="min-w-0 flex items-center gap-2">
          <ChannelBadge releaseType={version.release_type} />
          <span className="font-minecraft text-sm text-white normal-case truncate">{shortModpackVersion(version.version_number)}</span>
          {isInstalled && (
            <span className="shrink-0 rounded px-1.5 text-xs font-minecraft bg-green-500/20 text-green-300 border border-green-500/40">
              {t('modpack_versions.current')}
            </span>
          )}
        </span>
        <GameVersionPill versions={version.game_versions} />
        <span className="truncate font-minecraft text-xs text-white/45" title={new Date(version.date_published).toLocaleDateString()}>
          {formatShortAge(version.date_published)}
        </span>
        <span className="font-minecraft text-xs text-white/45 tabular-nums" title={version.downloads.toLocaleString()}>
          {formatCompactNumber(version.downloads)}
        </span>
        <span className="flex justify-end">
          {(version.changelog || version.source === "CurseForge") && (
            <button
              type="button"
              onClick={toggleExpanded}
              disabled={isLoadingChangelog}
              title={t('modpack_versions.changelog')}
              className={cn(
                "w-8 h-8 rounded-md flex items-center justify-center transition-colors",
                isExpanded ? "bg-white/10 text-white" : "text-white/50 hover:text-white hover:bg-white/10",
              )}
            >
              <Icon icon={isLoadingChangelog ? "svg-spinners:ring-resize" : "solar:document-text-bold"} className="w-4 h-4" />
            </button>
          )}
        </span>
      </div>

      {isExpanded && displayChangelog && (
        <div className="px-4 pb-3 pt-2 border-t border-white/5 bg-black/20 select-text">
          <div className="max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
            {isLoadingChangelog ? (
              <div className="flex items-center justify-center py-4">
                <Icon icon="svg-spinners:ring-resize" className="w-5 h-5 text-white/50" />
                <span className="ml-2 text-sm text-white/50 font-minecraft">{t('modpack_versions.loading_changelog')}</span>
              </div>
            ) : displayChangelog ? (
              version.source === "CurseForge" ? (
                <div
                  className="prose prose-invert prose-sm max-w-none font-minecraft [&_*]:text-white [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:first:mt-0 [&_h2]:text-base [&_h2]:font-bold [&_h2]:mb-2 [&_h2]:mt-3 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:mb-1 [&_h3]:mt-2 [&_p]:text-sm [&_p]:text-white/90 [&_p]:mb-2 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:list-inside [&_ul]:text-sm [&_ul]:text-white/90 [&_ul]:mb-2 [&_ul]:space-y-1 [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:list-inside [&_ol]:text-sm [&_ol]:text-white/90 [&_ol]:mb-2 [&_ol]:space-y-1 [&_ol]:ml-4 [&_li]:leading-relaxed [&_strong]:font-bold [&_strong]:text-white [&_em]:italic [&_em]:text-white/80 [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_code]:text-white/90 [&_pre]:bg-black/30 [&_pre]:p-2 [&_pre]:rounded [&_pre]:text-xs [&_pre]:font-mono [&_pre]:text-white/90 [&_pre]:overflow-x-auto [&_pre]:mb-2 [&_blockquote]:border-l-2 [&_blockquote]:border-accent [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-white/70 [&_blockquote]:my-2 [&_a]:text-accent [&_a]:hover:text-accent/80 [&_a]:underline"
                  dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(displayChangelog) }}
                />
              ) : (
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
  const [selectedVersion, setSelectedVersion] = useState<UnifiedVersion | null>(null);
  const onCloseRef = useLatest(onClose);

  React.useEffect(() => {
    if (!isOpen) {
      setSelectedVersion(null);
      setVersions(initialVersions);
      return;
    }
    if (initialVersions) {
      setVersions(initialVersions);
      return;
    }
    if (!profileId) return;
    let cancelled = false;
    ProfileService.getProfile(profileId)
      .then((profile) => {
        if (!profile.modpack_info?.source) throw new Error("No modpack source found in profile");
        return UnifiedService.getModpackVersions(profile.modpack_info.source);
      })
      .then((loaded) => {
        if (!cancelled) setVersions(loaded);
      })
      .catch((err) => {
        if (cancelled) return;
        logError(`Failed to load modpack versions: ${parseErrorMessage(err)}`);
        toast.error(parseErrorMessage(err));
        onCloseRef.current();
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, profileId, initialVersions, onCloseRef]);

  if (!isOpen || !versions) {
    return null;
  }

  const sortedVersions = [...versions.all_versions].sort(
    (a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime()
  );

  const installedVersionId = versions.installed_version?.id;

  const handleVersionSelect = (version: UnifiedVersion) => {
    if (version.id === installedVersionId) return;
    setSelectedVersion(version);
  };

  const handleSwitchVersion = async () => {
    if (!selectedVersion) return;

    if (profileId && selectedVersion.files.length > 0) {
      try {
        const primaryFile = selectedVersion.files.find(f => f.primary) || selectedVersion.files[0];

        let newModpackSource: ModPackSource;
        if (selectedVersion.source === "Modrinth") {
          newModpackSource = {
            source: "modrinth",
            project_id: selectedVersion.project_id,
            version_id: selectedVersion.id,
          };
        } else if (selectedVersion.source === "CurseForge") {
          const fileId = /^\d+$/.test(selectedVersion.id) ? Number(selectedVersion.id) : 0;
          if (fileId <= 0) {
            throw new Error("CurseForge file id not found");
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

        const loadingToast = toast.loading(t('modpack_versions.toast.switching', { name: modpackName, version: selectedVersion.version_number }));

        await UnifiedService.switchModpackVersion(request);

        toast.dismiss(loadingToast);
        toast.success(t('modpack_versions.toast.switch_success', { name: modpackName, version: selectedVersion.version_number }));


        if (onSwitchComplete) {
          await onSwitchComplete();
        }

        onClose();

      } catch (error) {
        toast.error(t('modpack_versions.toast.switch_failed', { error: parseErrorMessage(error) }));
      }
    } else if (onVersionSwitch) {
      onVersionSwitch(selectedVersion);
    }
  };

  return (
    <Modal
      title={t('modpack_versions.title', { name: modpackName })}
      titleIcon={<Icon icon="solar:archive-bold" className="w-6 h-6" />}
      titleClassName={PLAIN_TEXT}
      onClose={onClose}
      width="lg"
      className="max-h-[80vh]"
      footer={
        <div className="flex justify-end items-center gap-3">
          <Button
            variant="secondary"
            className={PLAIN_TEXT}
            onClick={onClose}
            disabled={isSwitching}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="success"
            className={PLAIN_TEXT}
            onClick={handleSwitchVersion}
            disabled={!selectedVersion || isSwitching}
            icon={isSwitching ? <Icon icon="svg-spinners:ring-resize" className="h-4 w-4" /> : <Icon icon="solar:refresh-circle-bold" className="h-4 w-4" />}
          >
            {isSwitching ? t('modpack_versions.button.switching') : selectedVersion ? t('modpack_versions.button.switch_version') : t('modpack_versions.button.select_version')}
          </Button>
        </div>
      }
    >
      <div className="px-6 pt-5 pb-1">
        {versions.updates_available && (
          <p className="mb-3 font-minecraft text-sm text-green-300">{t('modpack_versions.updates_available')}</p>
        )}

        <div className="rounded-lg border border-white/10 bg-black/20 overflow-hidden">
          <div className={`${VERSION_COLS} px-4 py-2.5 border-b border-white/10 font-minecraft text-xs text-white/40`}>
            <span className="truncate pl-9">{t("mod_detail.versions.col_version")}</span>
            <span className="truncate">{t("mod_detail.versions.col_game_version")}</span>
            <span className="truncate">{t("mod_detail.versions.col_published")}</span>
            <span className="truncate">{t("mod_detail.versions.col_downloads")}</span>
            <span />
          </div>
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
          <div className="text-center py-8 text-white/50 font-minecraft">
            {t('modpack_versions.no_versions')}
          </div>
        )}
      </div>
    </Modal>
  );
}
