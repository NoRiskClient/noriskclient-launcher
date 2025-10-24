"use client";

import type React from "react";
import { useState } from "react";
import { Button } from "../ui/buttons/Button";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { Modal } from "../ui/Modal";

interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateFolder: (folderName: string) => void;
}

export function CreateFolderModal({
  isOpen,
  onClose,
  onCreateFolder,
}: CreateFolderModalProps) {
  const [folderName, setFolderName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!folderName.trim()) {
      toast.error("Please enter a folder name");
      return;
    }

    if (folderName.trim().length < 2) {
      toast.error("Folder name must be at least 2 characters");
      return;
    }

    setIsLoading(true);
    
    try {
      await onCreateFolder(folderName.trim());
      setFolderName("");
    } catch (error) {
      console.error("Error creating folder:", error);
      toast.error("Failed to create folder");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setFolderName("");
    onClose();
  };

  return (
    <Modal
      title="Create New Folder"
      onClose={handleClose}
      variant="flat"
      footer={
        <div className="flex gap-3 justify-center">
          <Button
            type="button"
            variant="flat-secondary"
            onClick={handleClose}
            disabled={isLoading}
            size="sm"
          >
            Cancel
          </Button>
          
          <Button
            type="submit"
            variant="flat"
            disabled={isLoading || !folderName.trim()}
            size="sm"
            onClick={handleSubmit}
          >
            {isLoading ? (
              <>
                <Icon icon="solar:loading-bold" className="w-4 h-4 animate-spin mr-2" />
                Creating...
              </>
            ) : (
              <>
                <Icon icon="solar:folder-plus-bold" className="w-4 h-4 mr-2" />
                Create Folder
              </>
            )}
          </Button>
        </div>
      }
    >
      <div className="p-4 space-y-4">
        <div>
          <label 
            htmlFor="folderName" 
            className="block text-sm font-minecraft-ten text-white/80 mb-2"
          >
            Folder Name
          </label>
          <input
            id="folderName"
            type="text"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="Enter folder name..."
            className="w-full px-3 py-2 bg-black/30 border border-white/20 rounded-lg text-white placeholder-white/50 font-minecraft-ten focus:outline-none transition-colors"
            maxLength={50}
            autoFocus
          />
          <div className="text-xs text-white/50 mt-1">
            {folderName.length}/50 characters
          </div>
        </div>
      </div>
    </Modal>
  );
}
