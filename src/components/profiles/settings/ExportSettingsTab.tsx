import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ExportPackFormat, Profile } from "../../../types/profile"; // Adjust path as needed
import { SearchStyleInput } from "../../ui/Input";
import { Checkbox } from "../../ui/Checkbox";
import { Tooltip } from "../../ui/Tooltip";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/buttons/Button";
import { ExportFileSelector } from "./ExportFileSelector";
import { Icon } from "@iconify/react";
import * as ProfileService from "../../../services/profile-service"; // Adjust path as needed
import { toast } from "react-hot-toast";
import { useThemeStore } from "../../../store/useThemeStore";
import gsap from "gsap";
import { exportStepText, useExportProgress } from "../../../hooks/useExportProgress";
import { parseErrorMessage } from "../../../utils/error-utils";

const EXPORT_FORMATS: {
  value: ExportPackFormat;
  labelKey: string;
  extension: string;
  image: string;
  disabled?: boolean;
}[] = [
  {
    value: "noriskpack",
    labelKey: "export.format_noriskpack",
    extension: "noriskpack",
    image: "/logo.png",
  },
  {
    value: "mrpack",
    labelKey: "export.format_mrpack",
    extension: "mrpack",
    image: "https://cdn.modrinth.com/modrinth-new.png",
  },
  {
    value: "curseforge",
    labelKey: "export.format_curseforge",
    extension: "zip",
    image: "https://cdn.norisk.gg/misc/curseforge.webp",
  },
];

interface ExportSettingsTabProps {
  profile: Profile;
  // Removed onExport, isExporting, onClone, isCloning as they are handled internally or via ProfileService
  // The component will now directly call ProfileService methods
  onClose: () => void; // To close the modal after certain actions like cloning
  // New prop to provide export action and its state to the parent
  onExportActionAvailable?: (action: {
    handleExport: () => Promise<void>;
    isDisabled: () => boolean;
    exportOpenFolder: boolean;
    setExportOpenFolder: (value: boolean) => void;
    isExporting?: boolean;
  }) => void;
  isInModalContext?: boolean; // New prop, defaults to false
}

export function ExportSettingsTab({
  profile,
  onClose,
  onExportActionAvailable,
  isInModalContext = false, // Default to false
}: ExportSettingsTabProps) {
  const { t } = useTranslation();
  const [exportFilename, setExportFilename] = useState(profile.name);
  const [exportFormat, setExportFormat] =
    useState<ExportPackFormat>("noriskpack");
  const [selectedExportPaths, setSelectedExportPaths] = useState<Set<string>>(
    new Set()
  );
  // Ref to hold the latest selection, initialized with the initial state
  const selectedExportPathsRef = useRef<Set<string>>(selectedExportPaths);

  const [exportOpenFolder, setExportOpenFolder] = useState(true);

  const [isLoadingDirectory, setIsLoadingDirectory] = useState(true);

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportMessage, setExportMessage] = useState<string>("");
  const exportToastIdRef = useRef<string | null>(null);

  const isBackgroundAnimationEnabled = useThemeStore(
    (state) => state.isBackgroundAnimationEnabled
  );  const accentColor = useThemeStore((state) => state.accentColor);

  const handleFileSelectionChange = (newSelectedPaths: Set<string>) => {
    setSelectedExportPaths(newSelectedPaths);
    selectedExportPathsRef.current = newSelectedPaths;
  };

  useEffect(() => {
    selectedExportPathsRef.current = selectedExportPaths;
  }, [selectedExportPaths]);

  useExportProgress(
    profile.id,
    (step, progressPercent) => {
      const message = exportStepText(t, step);
      setExportMessage(message);
      if (progressPercent === null) return;
      setExportProgress(progressPercent);
      if (exportToastIdRef.current) {
        toast.loading(`${message} (${progressPercent}%)`, { id: exportToastIdRef.current });
      }
    },
    isExporting,
  );

  const handleExport = async () => {
    if (!exportFilename.trim()) {
      toast.error(t('export.enter_filename'));
      return;
    }

    const currentPathsForExport = selectedExportPathsRef.current;

    // Set exporting state and reset progress
    setIsExporting(true);
    setExportProgress(0);
    setExportMessage(t('export.starting'));

    const exportPromise = ProfileService.exportProfile({
      profile_id: profile.id,
      file_name: exportFilename,
      include_files:
        currentPathsForExport.size > 0 // Use the value from the ref
          ? Array.from(currentPathsForExport) // Use the value from the ref
          : undefined,
      open_folder: exportOpenFolder,
      format: exportFormat,
    });

    // Store the toast ID so we can update it with progress
    const toastId = toast.loading(t('export.exporting_profile', { name: exportFilename }));
    exportToastIdRef.current = toastId;

    try {
      const exportPath = await exportPromise;
      toast.success(t('export.export_success', { path: exportPath }), { id: toastId });
      setIsExporting(false);
      setExportProgress(null);
      setExportMessage("");
      exportToastIdRef.current = null;
    } catch (err) {
      const message = parseErrorMessage(err);
      console.error("Failed to export profile:", err);
      toast.error(t('export.export_failed', { error: message }), { id: toastId });
      setIsExporting(false);
      setExportProgress(null);
      setExportMessage("");
      exportToastIdRef.current = null;
    }
  };

  // GSAP animation for the tab content, similar to other tabs
  const contentRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isBackgroundAnimationEnabled && contentRef.current) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" }
      );
    }
  }, [isBackgroundAnimationEnabled]);

  // useEffect to pass the export action and disabled state to the parent IF in modal context
  useEffect(() => {
    if (isInModalContext && onExportActionAvailable) {
      onExportActionAvailable({
        handleExport,
        isDisabled: () =>
          isExporting || !exportFilename.trim() || isLoadingDirectory,
        exportOpenFolder,
        setExportOpenFolder,
        isExporting,
      });
    }
  }, [
    isInModalContext,
    onExportActionAvailable,
    isExporting,
    exportFilename,
    exportFormat,
    isLoadingDirectory,
    exportOpenFolder,
    setExportOpenFolder,
  ]);

  return (
    <div ref={contentRef} className="space-y-6">
      {!isInModalContext && (
        <div>
          <h3 className="text-lg font-smallcaps text-white mb-1">
            {t('export.title')}
          </h3>
          <p className="text-xs text-white/70 mb-4 font-minecraft tracking-wide">
            {t('export.description')}
          </p>
        </div>
      )}

      {/* Card now always wraps the main form elements */}
      <>
        {/* Filename input section */}
        <div className="space-y-1">
          <label
            htmlFor="exportFilename"
            className="block text-base text-white font-smallcaps mb-2"
          >
            {t('export.filename_label')}
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <SearchStyleInput
                value={exportFilename}
                onChange={(e) => setExportFilename(e.target.value)}
                placeholder={t('placeholders.enter_filename')}
                icon="solar:document-text-bold"
                disabled={isExporting}
              />
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {EXPORT_FORMATS.map((format) => {
                const isSelected = exportFormat === format.value;
                const isLocked = format.disabled === true;
                const label = isLocked
                  ? t('export.format_coming_soon', {
                      format: t(format.labelKey),
                    })
                  : t(format.labelKey);

                const isBlocked = isLocked || isExporting;

                return (
                  <Tooltip key={format.value} content={label} position="top">
                    <button
                      type="button"
                      aria-label={label}
                      aria-pressed={isSelected}
                      aria-disabled={isBlocked}
                      onClick={() => {
                        if (isBlocked) return;
                        setExportFormat(format.value as ExportPackFormat);
                      }}
                      className={cn(
                        "w-12 h-12 p-1.5 rounded-lg border-2 bg-black/30 transition-all duration-150",
                        isSelected ? "" : "border-white/10",
                        isLocked
                          ? "opacity-30 grayscale cursor-not-allowed"
                          : isExporting
                            ? "opacity-50 cursor-not-allowed"
                            : "cursor-pointer hover:border-white/25",
                      )}
                      style={
                        isSelected
                          ? {
                              borderColor: accentColor.value,
                              boxShadow: `0 0 0 2px ${accentColor.value}55`,
                            }
                          : undefined
                      }
                    >
                      <img
                        src={format.image}
                        alt=""
                        className={cn(
                          "w-full h-full object-contain",
                          !isSelected && !isLocked && "opacity-70",
                        )}
                      />
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </div>
          <p className="mt-1 text-xs text-white/50 font-minecraft tracking-wide truncate">
            {t('export.saved_as', {
              filename: `${exportFilename.trim() || profile.name}.${
                EXPORT_FORMATS.find((format) => format.value === exportFormat)
                  ?.extension ?? exportFormat
              }`,
            })}
          </p>
        </div>
        {/* File selection section */}
        <div>
          <h4 className="text-base font-smallcaps text-white mb-1">
            {t('export.select_files_title')}
          </h4>
          <p className="text-xs text-white/70 mb-3 font-minecraft tracking-wide">
            {t('export.select_files_description')}
          </p>
          <ExportFileSelector
            profileId={profile.id}
            selected={selectedExportPaths}
            onSelectionChange={handleFileSelectionChange}
            onLoadingChange={setIsLoadingDirectory}
          />
        </div>

        {/* Progress indicator during export (shown in both contexts) */}
        {isInModalContext && isExporting && exportProgress !== null && (
          <div className="mt-4 space-y-2">
            <div className="flex justify-between items-center text-sm font-minecraft">
              <span className="text-white/70">{exportMessage}</span>
              <span className="text-white font-smallcaps">{exportProgress}%</span>
            </div>
            <div className="w-full h-2 bg-black/30 border border-white/10 overflow-hidden">
              <div
                className="h-full transition-all duration-300 ease-out"
                style={{
                  width: `${exportProgress}%`,
                  backgroundColor: accentColor.value,
                  boxShadow: `0 0 10px ${accentColor.value}80`,
                }}
              />
            </div>
          </div>
        )}

        {!isInModalContext && ( // Internal controls only if NOT in modal context
          <>
            <div className="space-y-2 mt-4">
              <Checkbox
                checked={exportOpenFolder}
                onChange={(e) => setExportOpenFolder(e.target.checked)}
                label={t('export.open_folder_after')}
              className="text-sm"
                customSize="md"
                disabled={isExporting}
                variant="flat"
              />
            </div>

            {/* Progress indicator during export */}
            {isExporting && exportProgress !== null && (
              <div className="mt-4 space-y-2">
                <div className="flex justify-between items-center text-sm font-minecraft">
                  <span className="text-white/70">{exportMessage}</span>
                  <span className="text-white font-smallcaps">{exportProgress}%</span>
                </div>
                <div className="w-full h-2 bg-black/30 border border-white/10 overflow-hidden">
                  <div
                    className="h-full transition-all duration-300 ease-out"
                    style={{
                      width: `${exportProgress}%`,
                      backgroundColor: `rgb(${accentColor})`,
                      boxShadow: `0 0 10px rgba(${accentColor}, 0.5)`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="mt-6 pt-4 border-t border-white/10">
              <Button
                variant="default"
                onClick={handleExport}
                disabled={
                  isExporting || !exportFilename.trim() || isLoadingDirectory
                }
                icon={<Icon icon="solar:export-bold" className="w-5 h-5" />}
                size="md"
                className="text-sm w-full md:w-auto"
              >
                {isExporting ? t('export.exporting') : t('export.export_profile')}
              </Button>
            </div>
          </>
        )}
      </>
    </div>
  );
}
