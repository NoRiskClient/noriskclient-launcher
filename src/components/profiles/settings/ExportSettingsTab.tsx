"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Profile } from "../../../types/profile"; // Adjust path as needed
import { SearchStyleInput } from "../../ui/Input";
import { Checkbox } from "../../ui/Checkbox";
import { Button } from "../../ui/buttons/Button";
import { Card } from "../../ui/Card";
import { Icon } from "@iconify/react";
import { FileNodeViewer } from "../../file-explorer/FileNodeViewer"; // Adjust path as needed
import type { FileNode } from "../../../types/fileSystem"; // Adjust path as needed
import * as ProfileService from "../../../services/profile-service"; // Adjust path as needed
import { toast } from "react-hot-toast";
import { useThemeStore } from "../../../store/useThemeStore";
import gsap from "gsap";
import { listen } from "@tauri-apps/api/event";
import { EventType, type EventPayload } from "../../../types/events";

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
  const [selectedExportPaths, setSelectedExportPaths] = useState<Set<string>>(
    new Set()
  );
  // Ref to hold the latest selection, initialized with the initial state
  const selectedExportPathsRef = useRef<Set<string>>(selectedExportPaths);

  const [exportOpenFolder, setExportOpenFolder] = useState(true);

  const [directoryStructure, setDirectoryStructure] = useState<FileNode | null>(
    null
  );
  const [isLoadingDirectory, setIsLoadingDirectory] = useState(true);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

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

  // Listen for export progress events
  useEffect(() => {
    if (!isExporting || !profile.id) return;

    let isMounted = true;
    const unlistenPromise = listen<EventPayload>("state_event", (event) => {
      if (!isMounted) return;
      const payload = event.payload;

      // Only handle events for this profile
      if (payload.target_id === profile.id && payload.event_type === EventType.ExportingProfile) {
        setExportMessage(payload.message);
        
        if (payload.progress !== null) {
          const progressPercent = Math.round(payload.progress * 100);
          setExportProgress(progressPercent);
          
          // Update the existing loading toast with progress
          if (exportToastIdRef.current) {
            toast.loading(
              `${payload.message} (${progressPercent}%)`,
              { id: exportToastIdRef.current }
            );
          }
        }
      }
    });

    return () => {
      isMounted = false;
      unlistenPromise.then((unlisten) => unlisten()).catch(console.error);
    };
  }, [isExporting, profile.id]);

  useEffect(() => {
    const fetchStructure = async () => {
      if (!profile.id) {
        setDirectoryError(t('export.profile_id_missing'));
        setIsLoadingDirectory(false);
        return;
      }
      setIsLoadingDirectory(true);
      setDirectoryError(null);
      try {
        const structure = await ProfileService.getProfileDirectoryStructure(
          profile.id
        );
        console.log(structure);
        setDirectoryStructure(structure);
      } catch (err) {
        console.error("Failed to fetch directory structure:", err);
        const message = err instanceof Error ? err.message : String(err.message);
        setDirectoryError(t('export.load_structure_failed', { error: message }));
        toast.error(t('export.load_structure_failed', { error: message }));
      } finally {
        setIsLoadingDirectory(false);
      }
    };
    fetchStructure();
  }, [profile.id]);

  const getAllPathsRecursive = (node: FileNode, paths: Set<string>) => {
    paths.add(node.path);
    if (node.is_dir && node.children) {
      for (const child of node.children) {
        getAllPathsRecursive(child, paths);
      }
    }
  };
  const handleSelectAll = () => {
    if (!directoryStructure) return;
    const newSelectedPaths = new Set<string>();
    if (directoryStructure.children) {
      directoryStructure.children.forEach((childNode) =>
        getAllPathsRecursive(childNode, newSelectedPaths)
      );
    }
    setSelectedExportPaths(newSelectedPaths);
    selectedExportPathsRef.current = newSelectedPaths;
  };

  const handleDeselectAll = () => {
    const emptySet = new Set<string>();
    setSelectedExportPaths(emptySet);
    selectedExportPathsRef.current = emptySet;
  };

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
      const message = err instanceof Error ? err.message : String(err.message);
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
    isLoadingDirectory,
    exportOpenFolder,
    setExportOpenFolder,
  ]);

  return (
    <div ref={contentRef} className="space-y-6">
      {!isInModalContext && (
        <div>
          <h3 className="text-3xl font-minecraft text-white mb-1 lowercase">
            {t('export.title')}
          </h3>
          <p className="text-xs text-white/70 mb-4 font-minecraft-ten tracking-wide">
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
            className="block text-2xl text-white font-minecraft mb-2 lowercase"
          >
            {t('export.filename_label')}
          </label>
          <SearchStyleInput
            value={exportFilename}
            onChange={(e) => setExportFilename(e.target.value)}
            placeholder={t('placeholders.enter_filename')}
            icon="solar:document-text-bold"
            disabled={isExporting}
          />
          <p className="mt-1 text-xs text-white/50 font-minecraft-ten tracking-wide">
            {t('export.extension_added_auto')}
          </p>
        </div>
        {/* File selection section */}
        <div>
          <h4 className="text-2xl font-minecraft text-white lowercase mb-1">
            {t('export.select_files_title')}
          </h4>
          <p className="text-xs text-white/70 mb-3 font-minecraft-ten tracking-wide">
            {t('export.select_files_description')}
          </p>
          <div className="flex gap-2 mb-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSelectAll}
              disabled={
                isLoadingDirectory ||
                !directoryStructure ||
                !directoryStructure.children ||
                directoryStructure.children.length === 0
              }
              icon={
                <Icon icon="solar:check-read-outline" className="w-4 h-4" />
              }
              className="text-xs px-3 py-1.5"
            >
              {t('common.select_all')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDeselectAll}
              disabled={isLoadingDirectory || selectedExportPaths.size === 0}
              icon={
                <Icon icon="solar:close-circle-outline" className="w-4 h-4" />
              }
              className="text-xs px-3 py-1.5"
            >
              {t('export.deselect_all')}
            </Button>
          </div>
          <Card
            variant="flat"
            className="p-3 bg-black/20 border border-white/10 max-h-64 min-h-64 overflow-y-auto custom-scrollbar"
          >
            <FileNodeViewer
              rootNode={directoryStructure}
              loading={isLoadingDirectory}
              error={directoryError}
              selectedFiles={selectedExportPaths}
              onSelectionChange={handleFileSelectionChange}
              checkboxesEnabled={true}
              hideRootNode={true}
              preSelectPaths={[
                "resourcepacks",
                "shaderpacks",
                "options.txt",
                "NoRiskClientLauncher",
                "config",
                "custom_mods",
                "mods",
              ]}
              selectChildrenWithParent={true}
              defaultRootCollapsed={false}
              className="text-sm"
            />
          </Card>
        </div>

        {/* Progress indicator during export (shown in both contexts) */}
        {isInModalContext && isExporting && exportProgress !== null && (
          <div className="mt-4 space-y-2">
            <div className="flex justify-between items-center text-sm font-minecraft-ten">
              <span className="text-white/70">{exportMessage}</span>
              <span className="text-white font-minecraft">{exportProgress}%</span>
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

        {!isInModalContext && ( // Internal controls only if NOT in modal context
          <>
            <div className="space-y-2 mt-4">
              <Checkbox
                checked={exportOpenFolder}
                onChange={(e) => setExportOpenFolder(e.target.checked)}
                label={t('export.open_folder_after')}
                className="text-xl"
                customSize="md"
                disabled={isExporting}
                variant="flat"
              />
            </div>

            {/* Progress indicator during export */}
            {isExporting && exportProgress !== null && (
              <div className="mt-4 space-y-2">
                <div className="flex justify-between items-center text-sm font-minecraft-ten">
                  <span className="text-white/70">{exportMessage}</span>
                  <span className="text-white font-minecraft">{exportProgress}%</span>
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
                className="text-xl w-full md:w-auto"
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
