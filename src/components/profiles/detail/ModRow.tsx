"use client";

import React, { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../../lib/utils";
import type { Mod } from "../../../types/profile";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { invoke } from "@tauri-apps/api/core";
import type { ModrinthVersion } from "../../../types/modrinth";
import { useThemeStore } from "../../../store/useThemeStore";
import { IconButton } from "../../ui/buttons/IconButton";
import { Checkbox } from "../../ui/Checkbox";
import { Button } from "../../ui/buttons/Button";

interface ModRowProps {
  mod: Mod;
  isSelected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onUpdate?: (mod: Mod, version: ModrinthVersion) => void;
  updateVersion?: ModrinthVersion | null;
  checkingUpdates?: boolean;
  modrinthIconUrl?: string | null;
  style?: React.CSSProperties;
}

export const ModRow = React.memo(function ModRow({
  mod,
  isSelected,
  onSelect,
  onToggle,
  onDelete,
  onUpdate,
  updateVersion,
  checkingUpdates = false,
  modrinthIconUrl,
  style,
}: ModRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [localIcon, setLocalIcon] = useState<string | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const accentColor = useThemeStore((state) => state.accentColor);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchModIcon = async () => {
      try {
        if (modrinthIconUrl) {
          setIconUrl(modrinthIconUrl);
          return;
        }

        try {
          if (mod.source?.type === "local" && mod.source.file_name) {
            const iconsResult = await invoke<Record<string, string | null>>(
              "get_icons_for_norisk_mods",
              {
                mods: [{ filePath: mod.source.file_name }],
                minecraftVersion: mod.game_versions,
                loader: mod.associated_loader,
              },
            );

            if (iconsResult && iconsResult[mod.source.file_name]) {
              setLocalIcon(iconsResult[mod.source.file_name]);
            }
          }
        } catch (error) {
          console.error("Failed to fetch local mod icon:", error);
        }
      } catch (error) {
        console.error("Error in icon fetching process:", error);
      }
    };

    fetchModIcon();
  }, [mod, modrinthIconUrl]);

  const handleDelete = () => {
    if (isConfirmingDelete) {
      onDelete();
      setIsConfirmingDelete(false);
    } else {
      setIsConfirmingDelete(true);
      setTimeout(() => setIsConfirmingDelete(false), 3000);
    }
  };

  const handleUpdate = async () => {
    if (!updateVersion || !onUpdate) return;

    setIsUpdating(true);
    try {
      await onUpdate(mod, updateVersion);
    } finally {
      setIsUpdating(false);
    }
  };

  const hasUpdate =
    !!updateVersion && updateVersion.version_number !== mod.version;

  return (
    <div
      ref={rowRef}
      style={{ ...style, borderColor: `${accentColor.value}15` }}
      className={cn(
        "flex items-center py-4 px-4 border-b transition-colors",
        isSelected
          ? "bg-white/10"
          : isHovered
            ? "bg-white/5"
            : "bg-transparent",
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="w-8 flex justify-center">
        <Checkbox
          checked={isSelected}
          onChange={onSelect}
          aria-label={`Select ${mod.display_name || "mod"}`}
        />
      </div>

      <div className="flex items-center gap-3 flex-1 min-w-0 px-3">
        <div className="relative w-14 h-14 flex-shrink-0">
          <div
            className="absolute inset-0 rounded border-2 border-b-4 overflow-hidden"
            style={{
              backgroundColor: `${accentColor.value}15`,
              borderColor: `${accentColor.value}30`,
              borderBottomColor: `${accentColor.value}50`,
              boxShadow: `0 2px 4px rgba(0,0,0,0.2), inset 0 1px 0 ${accentColor.value}20`,
            }}
          >
            {iconUrl ? (
              <img
                src={iconUrl || "/placeholder.svg"}
                alt={mod.display_name || "Mod icon"}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={() => setIconUrl(null)}
              />
            ) : localIcon ? (
              <img
                src={`data:image/png;base64,${localIcon}`}
                alt={mod.display_name || "Mod icon"}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={() => setLocalIcon(null)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Icon
                  icon="solar:cube-bold"
                  className="w-7 h-7 text-white/60"
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col min-w-0">
          <div className="text-white font-minecraft text-2xl py-1 lowercase tracking-wide truncate flex items-center gap-2">
            {mod.display_name || "unknown mod"}
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
            {mod.source?.type === "modrinth"
              ? mod.source.project_id
              : mod.source?.type === "local"
                ? mod.source.file_name
                : mod.source?.type || "unknown"}
          </div>
        </div>
      </div>

      <div className="w-32 text-white/70 text-lg font-minecraft tracking-wide flex items-center gap-1">
        {mod.version || "?"}
      </div>

      <div className="w-16 flex justify-center">
        <ToggleSwitch checked={mod.enabled} onChange={onToggle} size="sm" />
      </div>

      <div className="w-24 flex items-center justify-center">
        <IconButton
          onClick={handleDelete}
          variant={isConfirmingDelete ? "destructive" : "secondary"}
          size="sm"
          icon={
            <Icon
              icon={
                isConfirmingDelete
                  ? "solar:danger-bold"
                  : "solar:trash-bin-trash-bold"
              }
              className="w-5 h-5"
            />
          }
          title={
            isConfirmingDelete
              ? "Click again to confirm deletion"
              : "Delete mod"
          }
        />
      </div>
    </div>
  );
});
