import { useEffect } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { type UnlistenFn, type Event as TauriEvent } from '@tauri-apps/api/event';
import type { PhysicalPosition } from '@tauri-apps/api/window'; // For payload.position
import { toast } from 'react-hot-toast';
// import { invoke } from '@tauri-apps/api/core'; // No longer directly needed here

import { useAppDragDropStore, type DragHoverKind } from '../store/appStore'; // Use the real store
import { useProfileStore } from '../store/profile-store'; // Import useProfileStore
import { useImportConfirmStore } from '../store/import-confirm-store';
import { parseErrorMessage } from '../utils/error-utils';
import { logInfo } from '../utils/logging-utils';
import i18n from '../i18n/i18n';
import * as ContentService from '../services/content-service';
import * as WorldService from '../services/world-service'; // Import WorldService
import { ContentType as BackendContentType } from '../types/content';

// Define the expected structure of the drag-drop event payload based on common Tauri patterns
interface WebviewDragDropPayload {
  type: 'enter' | 'over' | 'drop' | 'leave';
  paths?: string[];
  position?: PhysicalPosition;
}

// Simple cache for deduplicating rapid drop events
const recentlyProcessedPaths = new Set<string>();
const PROCESS_COOLDOWN_MS = 1500; // Cooldown period in milliseconds

const MODPACK_EXTENSIONS = ['.noriskpack', '.mrpack', '.zip'];

const CONTENT_EXTENSIONS: Partial<Record<BackendContentType, string[]>> = {
  [BackendContentType.Mod]: ['.jar', '.jar.disabled'],
  [BackendContentType.ResourcePack]: ['.zip', '.zip.disabled'],
  [BackendContentType.ShaderPack]: ['.zip', '.zip.disabled'],
  [BackendContentType.DataPack]: ['.zip', '.zip.disabled'],
};

const CONTENT_TYPE_LABELS: Partial<Record<BackendContentType, string>> = {
  [BackendContentType.Mod]: 'mods',
  [BackendContentType.ResourcePack]: 'resource packs',
  [BackendContentType.ShaderPack]: 'shader packs',
  [BackendContentType.DataPack]: 'data packs',
};

function acceptedContentExtensions(
  contentType: BackendContentType | null,
): string[] | undefined {
  return contentType ? CONTENT_EXTENSIONS[contentType] : undefined;
}

function classifyDrop(paths: string[]): DragHoverKind {
  if (paths.length === 0) return 'unsupported';

  const lower = paths.map((path) => path.toLowerCase());
  const { activeDropProfileId, activeDropContentType, activeMainTab } =
    useAppDragDropStore.getState();

  const accepted = acceptedContentExtensions(activeDropContentType);
  if (
    activeDropProfileId &&
    accepted &&
    lower.some((path) => accepted.some((ext) => path.endsWith(ext)))
  ) {
    return 'content';
  }

  if (lower.some((path) => MODPACK_EXTENSIONS.some((ext) => path.endsWith(ext)))) {
    return 'modpack';
  }

  if (activeMainTab === 'worlds' && activeDropProfileId) {
    const hasExtension = lower.some((path) => /\.[a-z0-9]{1,8}$/.test(path));
    if (!hasExtension) return 'world';
  }

  return 'unsupported';
}

export function useGlobalDragAndDrop() {
  // Destructure from store for useEffect dependencies, but use getState() inside event handler for freshest values.
  const { activeDropProfileId, activeDropContentType, triggerRefresh } = useAppDragDropStore();

  useEffect(() => {
    let unlistenDragDrop: UnlistenFn | undefined;
    const instanceId = Date.now(); // To distinguish listener instances if any HMR issues
    console.log(`[DragDrop Hook ${instanceId}] Initializing listener setup.`);

    const setupListener = async () => {
      try {
        const currentWebviewWindow = getCurrentWebviewWindow();
        
        unlistenDragDrop = await currentWebviewWindow.onDragDropEvent(async (event: TauriEvent<unknown>) => {
          const eventTimestamp = new Date().toISOString();
          console.log(`[DragDrop Hook ${instanceId}] Event received: ${event.payload ? (event.payload as any).type : 'unknown type'} at ${eventTimestamp}`);
          
          const payload = event.payload as WebviewDragDropPayload;

          if (payload.type === 'enter') {
            const hoveredPaths = payload.paths ?? [];
            useAppDragDropStore.getState().setDragHover({
              kind: classifyDrop(hoveredPaths),
              fileNames: hoveredPaths.map((path) => path.split(/[/\\]/).pop() ?? path),
            });
          } else if (payload.type === 'over') {
            return;
          } else if (payload.type === 'drop') {
            useAppDragDropStore.getState().setDragHover(null);
            const droppedPaths = payload.paths;
            console.log(`[DragDrop Hook ${instanceId}] Drop event with paths:`, droppedPaths);

            if (!droppedPaths || droppedPaths.length === 0) {
              return;
            }

            const pathKey = droppedPaths.slice().sort().join('|');

            if (recentlyProcessedPaths.has(pathKey)) {
              console.log(`[DragDrop Hook ${instanceId}] Duplicate drop event ignored (paths already processed recently): ${pathKey} at ${eventTimestamp}`);
              return; 
            }

            console.log(`[DragDrop Hook ${instanceId}] Processing new drop event for paths: ${pathKey} at ${eventTimestamp}`);
            recentlyProcessedPaths.add(pathKey);
            setTimeout(() => {
              recentlyProcessedPaths.delete(pathKey);
              console.log(`[DragDrop Hook ${instanceId}] Cleared pathKey from cache: ${pathKey}`);
            }, PROCESS_COOLDOWN_MS);

            const dropKind = classifyDrop(droppedPaths);
            const profilePackPath =
              dropKind === 'modpack'
                ? droppedPaths.find((path) =>
                    MODPACK_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext)),
                  )
                : undefined;

            if (profilePackPath) {
              // Check if this file is already being imported
              if (useProfileStore.getState().isPathImporting(profilePackPath)) {
                toast.error(i18n.t('dragdrop.already_importing'));
                return;
              }

              logInfo(`[DragDrop Hook ${instanceId}] Requesting import confirmation for: ${profilePackPath} at ${eventTimestamp}`);

              await useImportConfirmStore.getState().requestImport(profilePackPath);
              return;
            }

            const {
              activeDropProfileId: currentProfileId,
              activeDropContentType: currentContentType,
              activeMainTab: currentMainTab,
            } = useAppDragDropStore.getState();

            console.log(`[DragDrop Hook ${instanceId}] Drop context - MainTab: ${currentMainTab}, ProfileId: ${currentProfileId}, ContentType: ${currentContentType}`);

            // Check if WorldsTab is active and handle world folder drops
            if (currentMainTab === 'worlds' && currentProfileId) {
              // Filter for potential world folders (directories - paths without file extensions)
              // We'll try to import all dropped paths that don't have known file extensions
              const knownFileExtensions = ['.jar', '.zip', '.noriskpack', '.mrpack', '.disabled'];
              const potentialWorldFolders = droppedPaths.filter(path => {
                const lowerPath = path.toLowerCase();
                // Check if path doesn't end with a known file extension
                return !knownFileExtensions.some(ext => lowerPath.endsWith(ext));
              });

              if (potentialWorldFolders.length > 0) {
                const operationId = `world-import-${Date.now()}`;
                console.log(`[DragDrop Hook ${instanceId}] Initiating world import (OpID: ${operationId}) for ${potentialWorldFolders.length} folder(s) at ${eventTimestamp}`);
                
                // Process each potential world folder
                const importPromises = potentialWorldFolders.map(async (worldPath) => {
                  // Extract folder name from path for target name
                  const pathParts = worldPath.split(/[/\\]/);
                  const folderName = pathParts[pathParts.length - 1] || 'Imported World';
                  
                  try {
                    const generatedFolderName = await WorldService.importWorld(
                      currentProfileId,
                      worldPath,
                      folderName
                    );
                    console.log(`[DragDrop Hook ${instanceId}] World import SUCCESS for: ${worldPath} -> ${generatedFolderName}`);
                    return { success: true, path: worldPath, folderName: generatedFolderName };
                  } catch (err) {
                    console.error(`[DragDrop Hook ${instanceId}] World import ERROR for: ${worldPath}:`, err);
                    return { success: false, path: worldPath, error: err };
                  }
                });

                const loadingToastId = `loading-${operationId}`;
                toast.loading(i18n.t('dragdrop.importing_worlds', { count: potentialWorldFolders.length }), { id: loadingToastId });

                Promise.all(importPromises).then((results) => {
                  const successful = results.filter(r => r.success);
                  const failed = results.filter(r => !r.success);

                  if (successful.length > 0) {
                    console.log(`[DragDrop Hook ${instanceId}] World import completed: ${successful.length} successful, ${failed.length} failed`);
                    toast.success(
                      i18n.t('dragdrop.worlds_imported_success', { count: successful.length }) + (failed.length > 0 ? ` ${failed.length} failed.` : ''),
                      { id: loadingToastId, duration: 4000 }
                    );
                    // Trigger refresh of worlds list
                    useAppDragDropStore.getState().triggerWorldsRefresh();
                  } else {
                    console.error(`[DragDrop Hook ${instanceId}] All world imports failed`);
                    const errorMsg = failed.length > 0 && failed[0].error instanceof Error
                      ? failed[0].error.message
                      : 'Failed to import worlds';
                    toast.error(
                      i18n.t('dragdrop.worlds_import_failed', { error: errorMsg }),
                      { id: loadingToastId }
                    );
                  }
                });
                return;
              } else {
                toast(i18n.t('dragdrop.world_drop_hint'));
              }
            }

            if (currentProfileId && currentContentType) {
              const expectedExtensions = acceptedContentExtensions(currentContentType);
              if (!expectedExtensions) {
                toast.error(i18n.t('dragdrop.not_configured', { type: currentContentType }));
                return;
              }
              const itemTypeName = CONTENT_TYPE_LABELS[currentContentType] ?? currentContentType.toString();

              const relevantFiles = droppedPaths.filter(path =>
                expectedExtensions.some(ext => path.toLowerCase().endsWith(ext))
              );

              if (relevantFiles.length > 0) {
                const operationId = `op-${Date.now()}`;
                console.log(`[DragDrop Hook ${instanceId}] Initiating content import (OpID: ${operationId}) for ${relevantFiles.length} files at ${eventTimestamp}`);
                
                const loadingToastId = `loading-${operationId}`;
                toast.loading(i18n.t('dragdrop.importing_content', { count: relevantFiles.length, itemType: itemTypeName }), { id: loadingToastId });

                ContentService.installLocalContentToProfile({
                  profile_id: currentProfileId,
                  file_paths: relevantFiles,
                  content_type: currentContentType,
                })
                .then(() => {
                  console.log(`[DragDrop Hook ${instanceId}] Content import SUCCESS (OpID: ${operationId}) at ${new Date().toISOString()}`);
                  toast.success(
                    i18n.t('dragdrop.content_import_success', { count: relevantFiles.length, itemType: itemTypeName }),
                    { id: loadingToastId }
                  );
                  useAppDragDropStore.getState().triggerRefresh(currentContentType);
                })
                .catch((err) => {
                  console.error(`[DragDrop Hook ${instanceId}] Content import ERROR (OpID: ${operationId}) at ${new Date().toISOString()}:`, err);
                  toast.error(
                    i18n.t('dragdrop.content_import_failed', { itemType: itemTypeName, error: parseErrorMessage(err) }),
                    { id: loadingToastId }
                  );
                });
              } else {
                toast(i18n.t('dragdrop.no_matching_files', { extensions: expectedExtensions.join(', '), itemType: itemTypeName }));
              }
            } else {
              toast(i18n.t('dragdrop.drop_hint'));
            }
          } else if (payload.type === 'leave') {
            useAppDragDropStore.getState().setDragHover(null);
            logInfo(`[DragDrop Hook ${instanceId}] File drop cancelled at ${eventTimestamp}`);
          }
        });
      } catch (error) {
        console.error(`[DragDrop Hook ${instanceId}] Failed to set up drag and drop listener:`, error);
        toast.error(i18n.t('dragdrop.listener_init_failed'));
      }
    };

    setupListener();

    return () => {
      if (unlistenDragDrop) {
        console.log(`[DragDrop Hook ${instanceId}] Cleaning up listener.`);
        unlistenDragDrop();
      }
    };
  }, []); // Empty dependency array ensures this effect runs only once on mount and cleans up on unmount
} 