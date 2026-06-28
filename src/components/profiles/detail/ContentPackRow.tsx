"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import type { ModrinthVersion } from "../../../types/modrinth";
import { cn } from "../../../lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { useThemeStore } from "../../../store/useThemeStore";
import { IconButton } from "../../ui/buttons/IconButton";
import { Checkbox } from "../../ui/Checkbox";
import { Button } from "../../ui/buttons/Button";
import { gsap } from "gsap";

interface ContentPack {
  id?: string;
  display_name?: string | null;
  file_name?: string;
  enabled?: boolean;
  icon_url?: string;
  version?: string;
  creator?: string;
  source?: string;
  path?: string;
  file_size?: number;
  is_disabled?: boolean;
  sha1_hash?: string;
  modrinth_info?: {
    project_id: string;
    version_id: string;
    name: string;
    version_number: string;
    download_url: string;
  } | null;
  curseforge_info?: {
    project_id: string;
    file_id: string;
    name: string;
    version_number: string;
    download_url?: string | null;
  } | null;
  filename?: string;
}

interface ContentPackRowProps {
  contentPack: ContentPack;
  isSelected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onOpenDirectory?: () => void;
  onUpdate?: (packId: string) => void;
  updateVersion?: ModrinthVersion | null;
  checkingUpdates?: boolean;
  iconType?: string;
  formatFileSize?: (size: number) => string;
  onCheckForUpdates?: () => void;
  children?: React.ReactNode;
}

export function ContentPackRow({
  contentPack,
  isSelected,
  onSelect,
  onToggle,
  onDelete,
  onOpenDirectory,
  onUpdate,
  updateVersion,
  checkingUpdates,
  iconType = "solar:image-gallery-bold",
  formatFileSize,
  onCheckForUpdates,
  children,
}: ContentPackRowProps) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [localIcon, setLocalIcon] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const accentColor = useThemeStore((state) => state.accentColor);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (rowRef.current) {
      gsap.fromTo(
        rowRef.current,
        { opacity: 0, x: -10 },
        {
          opacity: 1,
          x: 0,
          duration: 0.3,
          ease: "power2.out",
        },
      );
    }
  }, []);

  const extractFileName = (path?: string): string => {
    if (!path) return t('content.unknown_file');
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || t('content.unknown_file');
  };

  const getDisplayName = (): string => {
    if (contentPack.file_name && contentPack.file_name !== "0")
      return contentPack.file_name;

    if (contentPack.path) return extractFileName(contentPack.path);

    if (contentPack.display_name) return contentPack.display_name;

    if (contentPack.modrinth_info?.name) return contentPack.modrinth_info.name;

    if (contentPack.curseforge_info?.name) return contentPack.curseforge_info.name;

    return t('content.unknown_pack');
  };

  const getFormattedFileSize = (): string | null => {
    if (contentPack.file_size && contentPack.file_size > 0 && formatFileSize) {
      return formatFileSize(contentPack.file_size);
    }
    return null;
  };

  useEffect(() => {
    const fetchPackIcon = async () => {
      if (contentPack.icon_url) return;

      try {
        if (contentPack.path) {
          const iconsResult = await invoke<Record<string, string | null>>(
            "get_icons_for_archives",
            {
              archivePaths: [contentPack.path],
            },
          );

          if (iconsResult && iconsResult[contentPack.path]) {
            setLocalIcon(iconsResult[contentPack.path]);
          }
        }
      } catch (error) {
        console.error("Failed to fetch content pack icon:", error);
      }
    };

    fetchPackIcon();
  }, [contentPack]);

  useEffect(() => {
    if (
      onCheckForUpdates &&
      contentPack.modrinth_info &&
      contentPack.sha1_hash
    ) {
      onCheckForUpdates();
    }
  }, []);

  const handleDelete = () => {
    if (deleteConfirm) {
      onDelete();
      setDeleteConfirm(false);
    } else {
      setDeleteConfirm(true);
      setTimeout(() => setDeleteConfirm(false), 3000);
    }
  };

  const handleUpdate = async () => {
    if (!updateVersion || !onUpdate) return;

    setIsUpdating(true);
    try {
      await onUpdate(contentPack.filename || contentPack.id || "");
    } finally {
      setIsUpdating(false);
    }
  };

  const hasUpdate =
    !!updateVersion &&
    contentPack.modrinth_info &&
    updateVersion.id !== contentPack.modrinth_info.version_id;

  const packName = getDisplayName();
  const fileSize = getFormattedFileSize();

  return (
    <div
      ref={rowRef}
      className={cn(
        "flex items-center py-3 px-4 border-b transition-colors",
        isSelected ? "bg-white/10" : "hover:bg-white/5",
      )}
      style={{
        borderColor: `${accentColor.value}15`,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="w-8 flex justify-center">
        <Checkbox
          checked={isSelected}
          onChange={onSelect}
          aria-label={`Select ${packName}`}
        />
      </div>

      <div className="flex items-center gap-3 flex-1 min-w-0 px-3">
        <div className="relative w-12 h-12 flex-shrink-0">
          <div
            className="absolute inset-0 border-2 border-b-4 overflow-hidden rounded-md"
            style={{
              backgroundColor: `${accentColor.value}15`,
              borderColor: `${accentColor.value}30`,
              borderBottomColor: `${accentColor.value}50`,
              boxShadow: `0 2px 4px rgba(0,0,0,0.2), inset 0 1px 0 ${accentColor.value}20`,
            }}
          >
            {contentPack.icon_url ? (
              <img
                src={contentPack.icon_url || "/placeholder.svg"}
                alt={packName}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={() => setLocalIcon(null)}
              />
            ) : localIcon ? (
              <img
                src={`data:image/png;base64,${localIcon}`}
                alt={packName}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={() => setLocalIcon(null)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Icon icon={iconType} className="w-6 h-6 text-white/60" />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col min-w-0">
          <div className="text-white py-1 font-minecraft text-2xl lowercase tracking-wide truncate flex items-center gap-2">
            {packName}
            {hasUpdate && (
              <Button
                size="xs"
                variant="success"
                className="flex items-center gap-1 cursor-pointer"
                onClick={handleUpdate}
                icon={
                  isUpdating ? (
                    <Icon
                      icon="solar:refresh-circle-bold-duotone"
                      className="w-3.5 h-3.5 animate-spin"
                    />
                  ) : (
                    <Icon icon="solar:refresh-bold" className="w-3.5 h-3.5" />
                  )
                }
              >
                update
              </Button>
            )}
          </div>
          <div className="text-white/50 text-lg lowercase truncate">
            {contentPack.creator && (
              <span className="mr-2">{t('content.by_creator', { creator: contentPack.creator })}</span>
            )}
            {contentPack.version && (
              <>
                {contentPack.creator && (
                  <span className="opacity-50 mx-1">•</span>
                )}
                <span>v{contentPack.version}</span>
              </>
            )}
            {fileSize && (
              <>
                {(contentPack.creator || contentPack.version) && (
                  <span className="opacity-50 mx-1">•</span>
                )}
                <span className="text-white/50">{fileSize}</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="w-16 flex justify-center">
        <ToggleSwitch
          checked={
            contentPack.enabled !== false && contentPack.is_disabled !== true
          }
          onChange={onToggle}
          size="sm"
        />
      </div>

      <div className="w-24 flex items-center justify-center gap-1">
        {onOpenDirectory && (
          <IconButton
            onClick={onOpenDirectory}
            variant="secondary"
            size="sm"
            icon={<Icon icon="solar:folder-open-bold" />}
            title={t('content.open_containing_folder')}
          />
        )}

        <IconButton
          onClick={handleDelete}
          variant={deleteConfirm ? "destructive" : "ghost"}
          size="sm"
          icon={
            <Icon
              icon={
                deleteConfirm
                  ? "solar:danger-bold"
                  : "solar:trash-bin-trash-bold"
              }
            />
          }
          title={
            deleteConfirm ? t('content.confirm_deletion') : t('content.delete_pack')
          }
        />
      </div>

      {children}
    </div>
  );
}
