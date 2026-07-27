"use client";

import { useRef, useState } from "react";
import { Icon } from "@iconify/react";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { useThemeStore } from "../../store/useThemeStore";
import { toast } from "react-hot-toast";
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useImportConfirmStore } from "../../store/import-confirm-store";
import { logInfo, logWarn } from "../../utils/logging-utils";
import { useTranslation } from "react-i18next";

interface ProfileImportProps {
  onClose: () => void;
  onImportComplete: () => void;
}

export function ProfileImport({
  onClose,
  onImportComplete,
}: ProfileImportProps) {
  const { t } = useTranslation();
  const [isImporting, setIsImporting] = useState(false);
  const accentColor = useThemeStore((state) => state.accentColor);
  const contentRef = useRef<HTMLDivElement>(null);
  const formatItemsRef = useRef<HTMLUListElement>(null);
  const requestImport = useImportConfirmStore((state) => state.requestImport);

  const handleImport = async () => {
    try {
      const selectedPath = await openDialog({
        multiple: false,
        directory: false,
        filters: [
          {
            name: t('profiles.import.modpack_files'),
            extensions: ["noriskpack", "mrpack", "zip"],
          },
        ],
        title: t('profiles.import.select_modpack'),
      });

      if (selectedPath && typeof selectedPath === "string") {
        setIsImporting(true);
        onClose();
        onImportComplete();
        await requestImport(selectedPath);
      } else if (selectedPath === null) {
        logInfo("[PackImport] Profile import dialog cancelled by user.");
      } else {
        logWarn(`[PackImport] File dialog returned no usable path: ${JSON.stringify(selectedPath)}`);
        toast.error(t('profiles.errors.file_path_failed'));
      }
    } finally {
      setIsImporting(false);
    }
  };

  const renderFooter = () => (
    <div className="flex justify-end">
      <Button
        variant="default"
        onClick={handleImport}
        disabled={isImporting}
        icon={<Icon icon="solar:upload-bold" className="w-5 h-5 text-white" />}
        size="md"
      >
        {isImporting ? (
          <>
            <Icon
              icon="svg-spinners:ring-resize"
              className="w-5 h-5 text-white"
            />
            <span>{t('profiles.importing')}</span>
          </>
        ) : (
          t('profiles.select_file_to_import')
        )}
      </Button>
    </div>
  );

  return (
    <Modal
      title={t('profiles.importProfile')}
      onClose={onClose}
      width="lg"
      footer={renderFooter()}
    >
      <div className="p-6" ref={contentRef}>
        <div className="space-y-6">
          <div>
            <p className="text-lg text-white/70 mb-6 font-minecraft tracking-wide select-none">
              {t('profiles.import_description')}
            </p>

            <div className="mb-6">
              <h3 className="text-base text-white font-smallcaps mb-4 select-none">
                {t('profiles.supported_formats')}
              </h3>
              <ul
                className="text-base text-white/80 space-y-4 select-none font-smallcaps"
                ref={formatItemsRef}
              >
                <li className="flex items-center">
                  <div
                    className="w-10 h-10 rounded-md flex items-center justify-center mr-4"
                    style={{
                      backgroundColor: `${accentColor.value}30`,
                      borderWidth: "2px",
                      borderStyle: "solid",
                      borderColor: `${accentColor.value}60`,
                    }}
                  >
                    <Icon
                      icon="solar:file-bold"
                      className="w-5 h-5 text-blue-400"
                    />
                  </div>
                  <span>{t('profiles.format_mrpack')}</span>
                </li>
                <li className="flex items-center">
                  <div
                    className="w-10 h-10 rounded-md flex items-center justify-center mr-4"
                    style={{
                      backgroundColor: `${accentColor.value}30`,
                      borderWidth: "2px",
                      borderStyle: "solid",
                      borderColor: `${accentColor.value}60`,
                    }}
                  >
                    <Icon
                      icon="solar:file-bold"
                      className="w-5 h-5 text-green-400"
                    />
                  </div>
                  <span>{t('profiles.format_noriskpack')}</span>
                </li>
                <li className="flex items-center">
                  <div
                    className="w-10 h-10 rounded-md flex items-center justify-center mr-4"
                    style={{
                      backgroundColor: `${accentColor.value}30`,
                      borderWidth: "2px",
                      borderStyle: "solid",
                      borderColor: `${accentColor.value}60`,
                    }}
                  >
                    <Icon
                      icon="solar:file-bold"
                      className="w-5 h-5 text-orange-400"
                    />
                  </div>
                  <span>{t('profiles.format_zip')}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
