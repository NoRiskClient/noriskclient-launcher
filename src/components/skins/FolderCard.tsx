"use client";

import type React from "react";
import { useState } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/useThemeStore";
import { useSkinFoldersStore, type SkinFolder } from "../../store/useSkinFoldersStore";
import { toast } from "react-hot-toast";

interface FolderCardProps {
  folder: SkinFolder;
  onClick: () => void;
  onDelete?: (folderId: string, folderName: string) => void;
  onRename?: (folderId: string, newName: string) => void;
  onDrop?: (folderId: string, skinId: string) => void;
}

export function FolderCard({
  folder,
  onClick,
  onDelete,
  onRename,
  onDrop,
}: FolderCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const [isDragOver, setIsDragOver] = useState(false);
  const accentColor = useThemeStore((state) => state.accentColor);
  const { deleteFolder, renameFolder } = useSkinFoldersStore();

  const handleRename = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!editName.trim() || editName.trim() === folder.name) {
      setIsEditing(false);
      setEditName(folder.name);
      return;
    }

    if (editName.trim().length < 2) {
      toast.error("Folder name must be at least 2 characters");
      return;
    }

    renameFolder(folder.id, editName.trim());
    setIsEditing(false);
    toast.success(`📁 Folder renamed to "${editName.trim()}"`);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (onDelete) {
      onDelete(folder.id, folder.name);
    } else {
      deleteFolder(folder.id);
      toast.success(`📁 Folder "${folder.name}" deleted`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsEditing(false);
      setEditName(folder.name);
    } else if (e.key === 'Enter') {
      handleRename(e);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const skinId = e.dataTransfer.getData("text/plain");
    if (skinId && onDrop) {
      onDrop(folder.id, skinId);
    }
  };

  return (
    <div
      className={cn(
        "relative flex flex-col gap-3 p-4 rounded-lg bg-black/20 border border-white/10 hover:border-white/20 transition-all duration-200 cursor-pointer group",
        "animate-in fade-in duration-500"
      )}
      style={{
        backgroundColor: isDragOver ? `${accentColor.value}30` : (isHovered ? `${accentColor.value}20` : undefined),
        borderColor: isDragOver ? accentColor.value : (isHovered ? `${accentColor.value}60` : undefined),
      }}
      onClick={() => !isEditing && onClick()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDragOver={handleDragOver}
      onDragEnter={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Action buttons - top right */}
      <div className="absolute top-3 right-3 z-20 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        {/* Rename button */}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsEditing(true);
            setEditName(folder.name);
          }}
          className="w-8 h-8 flex items-center justify-center bg-black/30 hover:bg-black/50 text-white/70 hover:text-white border border-white/10 hover:border-white/20 rounded transition-all duration-200"
          title="Rename Folder"
        >
          <Icon icon="solar:pen-bold" className="w-4 h-4" />
        </button>
        
        {/* Delete button */}
        <button
          onClick={handleDelete}
          className="w-8 h-8 flex items-center justify-center bg-black/30 hover:bg-red-500/20 text-white/70 hover:text-red-400 border border-white/10 hover:border-red-400/40 rounded transition-all duration-200"
          title="Delete Folder"
        >
          <Icon icon="solar:trash-bin-trash-bold" className="w-4 h-4" />
        </button>
      </div>

      {/* Folder content */}
      <div className="flex flex-col items-center gap-3 relative z-10 w-full">
        {/* Folder Icon */}
        <div
          className="relative flex-shrink-0 rounded-lg flex items-center justify-center overflow-hidden border border-transparent transition-all duration-300 ease-out"
          style={{
            width: "140px",
            height: "280px",
          }}
        >
          <div className="w-full h-full flex items-center justify-center">
            <Icon 
              icon="solar:folder-bold" 
              className="w-20 h-20 text-white" 
            />
          </div>
          
          {/* Drop indicator */}
          {isDragOver && (
            <div className="absolute inset-0 bg-blue-500/20 border-2 border-dashed border-blue-400 rounded-lg flex items-center justify-center">
              <div className="text-center">
                <Icon icon="solar:download-bold" className="w-8 h-8 text-blue-400 mx-auto mb-2" />
                <div className="text-blue-400 text-xs font-minecraft-ten">Drop Skin Here</div>
              </div>
            </div>
          )}
        </div>

        {/* Folder Info */}
        <div className="flex-grow min-w-0 w-full text-center">
          {/* Folder Name */}
          {isEditing ? (
            <form onSubmit={handleRename} className="w-full">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => {
                  setIsEditing(false);
                  setEditName(folder.name);
                }}
                className="w-full px-2 py-1 bg-black/30 border border-blue-400 rounded text-white text-center font-minecraft-ten text-base focus:outline-none"
                autoFocus
                maxLength={50}
              />
            </form>
          ) : (
            <h3
              className="font-minecraft-ten text-white text-base whitespace-nowrap overflow-hidden text-ellipsis max-w-full normal-case mb-1"
              title={folder.name}
            >
              {folder.name}
            </h3>
          )}

          {/* Folder Stats */}
          <div className="flex items-center justify-center gap-2 text-xs font-minecraft-ten">
            <div className="text-white/60 flex items-center gap-1">
              <span>Folder</span>
              <span className="text-white/40">•</span>
              <span className="text-white/80">{folder.skin_ids.length} Skin{folder.skin_ids.length !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
