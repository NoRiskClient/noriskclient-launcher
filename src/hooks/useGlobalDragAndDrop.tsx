import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, type UnlistenFn, type Event as TauriEvent } from '@tauri-apps/api/event';
import type { PhysicalPosition } from '@tauri-apps/api/window'; // For payload.position
import { toast } from 'react-hot-toast';
// import { invoke } from '@tauri-apps/api/core'; // No longer directly needed here

import { useAppDragDropStore } from '../store/appStore'; // Use the real store
import { useProfileStore } from '../store/profile-store'; // Import useProfileStore
import { parseErrorMessage } from '../utils/error-utils';
import i18n from '../i18n/i18n';
import * as ContentService from '../services/content-service';
import * as ProfileService from '../services/profile-service'; // Import ProfileService
import * as WorldService from '../services/world-service'; // Import WorldService
import { ContentType as BackendContentType } from '../types/content';
import { EventType, type EventPayload } from '../types/events';
import { ProgressToast } from '../components/ui/ProgressToast';

// Define the expected structure of the drag-drop event payload based on common Tauri patterns
interface WebviewDragDropPayload {
  type: 'hover' | 'drop' | 'cancel';
  paths?: string[];
  position?: PhysicalPosition;
}

// Simple cache for deduplicating rapid drop events
const recentlyProcessedPaths = new Set<string>();
const PROCESS_COOLDOWN_MS = 1500; // Cooldown period in milliseconds

export function useGlobalDragAndDrop() {
  // Destructure from store for useEffect dependencies, but use getState() inside event handler for freshest values.
  const { activeDropProfileId, activeDropContentType, triggerRefresh } = useAppDragDropStore();
  const navigate = useNavigate();

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

          if (payload.type === 'hover') {
            // console.log('User hovering over window at:', payload.position, 'with paths:', payload.paths);
          } else if (payload.type === 'drop') {
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

            const profilePackPath = droppedPaths.find(path =>
              path.toLowerCase().endsWith('.noriskpack') || path.toLowerCase().endsWith('.mrpack') || path.toLowerCase().endsWith('.zip')
            );

            if (profilePackPath) {
              const { isPathImporting, addImportingPath, removeImportingPath } = useProfileStore.getState();

              // Check if this file is already being imported
              if (isPathImporting(profilePackPath)) {
                toast.error(i18n.t('dragdrop.already_importing'));
                return;
              }

              const eventId = crypto.randomUUID();
              const toastId = `import-${eventId}`;
              let progressUnlisten: UnlistenFn | null = null;

              console.log(`[DragDrop Hook ${instanceId}] Initiating profile import (EventID: ${eventId}) for: ${profilePackPath} at ${eventTimestamp}`);
              const fileName = profilePackPath.substring(profilePackPath.lastIndexOf('/') + 1).substring(profilePackPath.lastIndexOf('\\') + 1); // Get file name for toast

              addImportingPath(profilePackPath);

              try {
                // Set up event listener for progress updates
                progressUnlisten = await listen<EventPayload>("state_event", (progressEvent) => {
                  const progressPayload = progressEvent.payload;
                  if (progressPayload.event_type !== EventType.TaskProgress) return;
                  if (progressPayload.event_id !== eventId) return;

                  const progress = (progressPayload.progress ?? 0) * 100; // Convert 0-1 to 0-100

                  // Update toast with progress
                  toast.custom(
                    () => <ProgressToast message={i18n.t('dragdrop.importing', { fileName })} progress={progress} />,
                    { id: toastId, duration: Infinity }
                  );
                });

                // Show initial progress toast
                toast.custom(
                  () => <ProgressToast message={i18n.t('dragdrop.importing', { fileName })} progress={0} />,
                  { id: toastId, duration: Infinity }
                );

                const newProfileId = await ProfileService.importProfileByPath(profilePackPath, eventId);
                console.log(`[DragDrop Hook ${instanceId}] Profile import SUCCESS (EventID: ${eventId}) for: ${profilePackPath} at ${new Date().toISOString()}`);

                // Clean up listener before showing success
                if (progressUnlisten) {
                  progressUnlisten();
                  progressUnlisten = null;
                }

                toast.success(
                  i18n.t('dragdrop.import_success', { fileName }),
                  { id: toastId, duration: 3000 }
                );
                useProfileStore.getState().fetchProfiles(); // Fetch profiles after successful import

                // Navigate to the new profile
                navigate(`/profilesv2/${newProfileId}`);
              } catch (err) {
                console.error(`[DragDrop Hook ${instanceId}] Profile import ERROR (EventID: ${eventId}) for: ${profilePackPath} at ${new Date().toISOString()}:`, err);
                const errorMessage = parseErrorMessage(err);

                // Check for disk space error and provide helpful hint
                if (errorMessage.toLowerCase().includes("insufficient disk space")) {
                  toast.error(
                    `${errorMessage}\n\n${i18n.t('dragdrop.disk_space_tip')}`,
                    { id: toastId, duration: 8000 }
                  );
                } else {
                  toast.error(
                    i18n.t('dragdrop.import_failed', { fileName, error: errorMessage }),
                    { id: toastId }
                  );
                }
              } finally {
                // Clean up listener
                if (progressUnlisten) {
                  progressUnlisten();
                }
                removeImportingPath(profilePackPath);
              }
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
              let relevantFiles: string[] = [];
              let expectedExtensions: string[] = [];
              let itemTypeName = currentContentType.toString();

              switch (currentContentType) {
                case BackendContentType.Mod:
                  expectedExtensions = ['.jar', '.jar.disabled'];
                  itemTypeName = 'mods';
                  break;
                case BackendContentType.ResourcePack:
                  expectedExtensions = ['.zip', '.zip.disabled'];
                  itemTypeName = 'resource packs';
                  break;
                case BackendContentType.ShaderPack:
                  expectedExtensions = ['.zip', '.zip.disabled'];
                  itemTypeName = 'shader packs';
                  break;
                case BackendContentType.DataPack:
                  expectedExtensions = ['.zip', '.zip.disabled'];
                  itemTypeName = 'data packs';
                  break;
                default:
                  toast.error(i18n.t('dragdrop.not_configured', { type: currentContentType }));
                  return;
              }

              relevantFiles = droppedPaths.filter(path => 
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
                    i18n.t('dragdrop.content_import_failed', { itemType: itemTypeName, error: err instanceof Error ? err.message : String(err) }),
                    { id: loadingToastId }
                  );
                });
              } else {
                toast(i18n.t('dragdrop.no_matching_files', { extensions: expectedExtensions.join(', '), itemType: itemTypeName }));
              }
            } else {
              toast(i18n.t('dragdrop.drop_hint'));
            }
          } else if (payload.type === 'cancel') {
            console.log(`[DragDrop Hook ${instanceId}] File drop cancelled at ${eventTimestamp}`);
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