"use client";

import type React from "react";
import { useState } from "react";
import { Button } from "../ui/buttons/Button";
import { Icon } from "@iconify/react";
import type { MinecraftSkin } from "../../types/localSkin";
import type { SkinFolder } from "../../store/useSkinFoldersStore";
import { useThemeStore } from "../../store/useThemeStore";
import { Modal } from "../ui/Modal";

interface MoveToFolderModalProps {
  isOpen: boolean;
  skin: MinecraftSkin;
  folders: SkinFolder[];
  onClose: () => void;
  onMoveToFolder: (folderId: string) => void;
}

export function MoveToFolderModal({
  isOpen,
  skin,
  folders,
  onClose,
  onMoveToFolder,
}: MoveToFolderModalProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string>("");
  const accentColor = useThemeStore((state) => state.accentColor);

  const handleSubmit = () => {
    if (!selectedFolderId) {
      return;
    }

    onMoveToFolder(selectedFolderId);
  };

  if (!isOpen) return null;

  return (
    <Modal
      title="Move Skin to Folder"
      onClose={onClose}
      variant="flat"
      width="sm"
      footer={
        <div className="flex gap-3 justify-center">
          <Button
            type="button"
            variant="flat-secondary"
            onClick={onClose}
            size="sm"
          >
            Cancel
          </Button>
          
          <Button
            type="button"
            variant="flat"
            disabled={!selectedFolderId}
            size="sm"
            onClick={handleSubmit}
          >
            Move to Folder
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        {/* Skin Info */}
        <div className="p-4 bg-black/20 rounded-lg border border-white/10">
          <div>
            <h3 
              className="text-white font-minecraft-ten text-sm truncate mb-1" 
              title={skin.name}
            >
              {skin.name}
            </h3>
            <p className="text-white/60 text-xs font-minecraft-ten">
              {skin.variant === "slim" ? "Slim" : "Classic"} Skin
            </p>
          </div>
        </div>

        {/* Folder Selection */}
        <div>
          <label className="block text-sm font-minecraft-ten text-white/80 mb-2">
            Select Folder
          </label>
          <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
            {folders.map((folder) => (
              <button
                key={folder.id}
                onClick={() => setSelectedFolderId(folder.id)}
                className={`w-full p-3 rounded-lg border transition-all duration-200 text-left ${
                  selectedFolderId === folder.id
                    ? 'text-white'
                    : 'bg-black/20 border-white/10 hover:border-white/20 text-white/80 hover:text-white'
                }`}
                style={
                  selectedFolderId === folder.id
                    ? {
                        backgroundColor: `${accentColor.value}20`,
                        borderColor: accentColor.value,
                      }
                    : undefined
                }
              >
                <div className="flex items-center gap-3">
                  <Icon 
                    icon="solar:folder-bold" 
                    className="w-5 h-5"
                    style={{ color: accentColor.value }}
                  />
                  <div>
                    <div className="font-minecraft-ten text-sm">{folder.name}</div>
                    <div className="text-xs text-white/60 font-minecraft-ten">
                      {folder.skin_ids.length} skins
                    </div>
                  </div>
                </div>
              </button>
            ))}
            
            {folders.length === 0 && (
              <div className="text-center py-8 text-white/60 font-minecraft-ten text-sm">
                No folders available. Create a folder first.
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
