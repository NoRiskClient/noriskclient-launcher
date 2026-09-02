"use client";

import { useRef, useState } from "react";
import { Icon } from "@iconify/react";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { useThemeStore } from "../../store/useThemeStore";
import { toast } from "react-hot-toast";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useImportConfirmStore } from "../../store/import-confirm-store";
import { logInfo, logWarn } from "../../utils/logging-utils";
import { useTranslation } from "react-i18next";
import { importSharedProfile } from "../../services/profile-share-service";

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
  const [isCodeImporting, setIsCodeImporting] = useState(false);
  const [shareCode, setShareCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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
            name: t("profiles.import.modpack_files"),
            extensions: ["noriskpack", "mrpack", "zip"],
          },
        ],
        title: t("profiles.import.select_modpack"),
      });

      if (selectedPath && typeof selectedPath === "string") {
        setIsImporting(true);
        onClose();
        onImportComplete();
        await requestImport(selectedPath);
      } else if (selectedPath === null) {
        logInfo("[PackImport] Profile import dialog cancelled by user.");
      } else {
        logWarn(
          `[PackImport] File dialog returned no usable path: ${JSON.stringify(selectedPath)}`,
        );
        toast.error(t("profiles.errors.file_path_failed"));
      }
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportCode = async () => {
    const code = shareCode.trim();
    if (!code) {
      toast.error("Enter a share code first");
      return;
    }

    setIsCodeImporting(true);
    try {
      const newProfileId = await toast.promise(importSharedProfile(code), {
        loading: "Importing shared profile...",
        success: "Shared profile imported",
        error: (err) => (err instanceof Error ? err.message : String(err)),
      });
      useProfileStore.getState().fetchProfiles();
      onImportComplete();
      onClose();
      navigate(`/profilesv2/${newProfileId}`);
    } finally {
      setIsCodeImporting(false);
    }
  };

  const renderFooter = () => (
    <div className="flex justify-end gap-3">
      <Button
        variant="secondary"
        onClick={handleImportCode}
        disabled={isImporting || isCodeImporting || !shareCode.trim()}
        icon={
          <Icon
            icon="solar:key-minimalistic-square-bold"
            className="w-5 h-5 text-white"
          />
        }
        size="md"
      >
        {isCodeImporting ? "importing code" : "import code"}
      </Button>
      <Button
        variant="default"
        onClick={handleImport}
        disabled={isImporting || isCodeImporting}
        icon={<Icon icon="solar:upload-bold" className="w-5 h-5 text-white" />}
        size="md"
      >
        {isImporting ? (
          <>
            <Icon
              icon="svg-spinners:ring-resize"
              className="w-5 h-5 text-white"
            />
            <span>{t("profiles.importing")}</span>
          </>
        ) : (
          t("profiles.select_file_to_import")
        )}
      </Button>
    </div>
  );

  return (
    <Modal
      title={t("profiles.importProfile")}
      onClose={onClose}
      width="lg"
      footer={renderFooter()}
    >
      <div className="p-6" ref={contentRef}>
        <div className="space-y-6">
          <div>
            <p className="text-lg text-white/70 mb-6 font-minecraft tracking-wide select-none">
              {t("profiles.import_description")}
            </p>

            <div className="mb-6">
              <label
                htmlFor="profileShareCode"
                className="block text-2xl text-white font-minecraft mb-3 select-none lowercase"
              >
                share code
              </label>
              <div className="flex gap-3">
                <input
                  id="profileShareCode"
                  value={shareCode}
                  onChange={(event) =>
                    setShareCode(event.target.value.toUpperCase())
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void handleImportCode();
                    }
                  }}
                  disabled={isImporting || isCodeImporting}
                  maxLength={16}
                  className="min-w-0 flex-1 rounded-md border-2 bg-black/30 px-4 py-3 font-minecraft text-2xl text-white outline-none placeholder:text-white/35"
                  style={{ borderColor: `${accentColor.value}60` }}
                  placeholder="ABCDEFGH"
                />
              </div>
            </div>

            <div className="mb-6">
              <h3 className="text-2xl text-white font-minecraft mb-4 select-none lowercase">
                {t("profiles.supported_formats")}
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
                  <span>{t("profiles.format_mrpack")}</span>
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
                  <span>{t("profiles.format_noriskpack")}</span>
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
                  <span>{t("profiles.format_zip")}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
