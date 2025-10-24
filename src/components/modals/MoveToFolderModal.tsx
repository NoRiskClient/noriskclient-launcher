"use client";

import type React from "react";
import { useState } from "react";
import { Button } from "../ui/buttons/Button";
import { Icon } from "@iconify/react";
import type { MinecraftSkin } from "../../types/localSkin";
import type { SkinFolder } from "../../store/useSkinFoldersStore";

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedFolderId) {
      return;
    }

    onMoveToFolder(selectedFolderId);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-white/20 rounded-lg p-6 w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Icon 
              icon="solar:folder-bold" 
              className="w-6 h-6 text-blue-400" 
            />
            <h2 className="text-xl font-minecraft-ten text-white">
              Move Skin to Folder
            </h2>
          </div>
          
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white transition-colors"
          >
            <Icon icon="solar:close-circle-bold" className="w-6 h-6" />
          </button>
        </div>

        {/* Skin Info */}
        <div className="mb-6 p-4 bg-black/20 rounded-lg border border-white/10">
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
        <div className="space-y-4">
          <div>
            <div className="space-y-2 max-h-48 overflow-y-auto no-scrollbar">
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => setSelectedFolderId(folder.id)}
                  className={`w-full p-3 rounded-lg border transition-all duration-200 text-left ${
                    selectedFolderId === folder.id
                      ? 'bg-blue-500/20 border-blue-400 text-white'
                      : 'bg-black/20 border-white/10 hover:border-white/20 text-white/80 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon 
                      icon="solar:folder-bold" 
                      className="w-5 h-5 text-blue-400" 
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

        {/* Actions */}
        <div className="flex items-center justify-center gap-3 pt-6 mt-6 border-t border-white/10">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="w-32"
          >
            Cancel
          </Button>
          
          <Button
            type="submit"
            variant="primary"
            disabled={!selectedFolderId}
            onClick={handleSubmit}
            className="w-32"
          >
            Move
          </Button>
        </div>
      </div>
    </div>
  );
}
