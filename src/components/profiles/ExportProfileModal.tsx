"use client";

import React, { useState } from "react";
import type { Profile } from "../../types/profile";
import { ExportSettingsTab } from "./settings/ExportSettingsTab";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { useThemeStore } from "../../store/useThemeStore";
import { Icon } from "@iconify/react";
import { Checkbox } from "../ui/Checkbox";

interface ExportProfileModalProps {
  profile: Profile;
  isOpen: boolean;
  onClose: () => void;
}

export function ExportProfileModal({
  profile,
  isOpen,
  onClose,
}: ExportProfileModalProps) {
  const accentColor = useThemeStore((state) => state.accentColor);

  const [exportAction, setExportAction] = useState<{
    handleExport: () => Promise<void>;
    isDisabled: () => boolean;
    exportOpenFolder: boolean;
    setExportOpenFolder: (value: boolean) => void;
  } | null>(null);

  if (!isOpen) {
    return null;
  }

  const footerContent = exportAction ? (
    <div className="flex justify-between items-center w-full">
      <div>
        <Checkbox
          checked={exportAction.exportOpenFolder}
          onChange={(e) => exportAction.setExportOpenFolder(e.target.checked)}
          label="Open folder after export"
          className="text-base"
          customSize="md"
          disabled={exportAction.isDisabled()}
        />
      </div>
      <div>
        <Button
          variant="default"
          onClick={exportAction.handleExport}
          disabled={exportAction.isDisabled()}
          icon={<Icon icon="solar:export-bold" className="w-5 h-5" />}
          size="md"
          className="text-xl"
        >
          Export Profile
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <Modal
      title={`Export Profile: ${profile.name}`}
      onClose={onClose}
      width="lg"
      footer={footerContent}
    >
      <div className="p-6">
        <ExportSettingsTab
          profile={profile}
          onClose={onClose}
          onExportActionAvailable={setExportAction}
          isInModalContext={true}
        />
      </div>
    </Modal>
  );
}
