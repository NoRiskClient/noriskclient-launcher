import { useEffect, useRef, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useImportProgressStore } from "../store/import-progress-store";
import { EventType, EventPayload } from "../types/events";
import { toast as hotToast } from "react-hot-toast";
import { ProgressToast } from "../components/ui/ProgressToast";

interface UseImportProgressOptions {
  toastId?: string;
  fileName?: string;
  onComplete?: () => void;
  onError?: (error: string) => void;
}

/**
 * Hook to track import progress from backend events.
 * Listens to ImportingProfile events and updates the progress store.
 * Optionally displays a progress toast.
 */
export function useImportProgress(eventId: string | null, options: UseImportProgressOptions = {}) {
  const { toastId, fileName, onComplete, onError } = options;
  const { setImportProgress, updateImportProgress, clearImport, getImport } = useImportProgressStore();
  const listenerRef = useRef<UnlistenFn | null>(null);
  const isCompletedRef = useRef(false);

  // Update toast with current progress
  const updateToast = useCallback((progress: number) => {
    if (toastId && fileName) {
      hotToast.custom(
        () => <ProgressToast message={`Importing ${fileName}`} progress={progress} />,
        { id: toastId, duration: Infinity }
      );
    }
  }, [toastId, fileName]);

  useEffect(() => {
    if (!eventId) return;

    // Initialize import tracking
    if (fileName) {
      setImportProgress(eventId, { fileName, progress: 0, currentStep: "Starting..." });
    }

    const setupListener = async () => {
      listenerRef.current = await listen<EventPayload>("state_event", (event) => {
        const payload = event.payload;

        // Only handle ImportingProfile events for our event_id
        if (payload.event_type !== EventType.TaskProgress) return;
        if (payload.event_id !== eventId) return;

        const progress = payload.progress ?? 0;
        const step = payload.message || "";

        // Update store
        updateImportProgress(eventId, progress, step);

        // Update toast
        updateToast(progress);

        // Handle completion
        if (progress >= 100 && !isCompletedRef.current) {
          isCompletedRef.current = true;
          setTimeout(() => {
            clearImport(eventId);
            onComplete?.();
          }, 500);
        }

        // Handle errors
        if (payload.error) {
          clearImport(eventId);
          onError?.(payload.error);
        }
      });
    };

    setupListener();

    return () => {
      if (listenerRef.current) {
        listenerRef.current();
        listenerRef.current = null;
      }
    };
  }, [eventId, fileName, setImportProgress, updateImportProgress, clearImport, updateToast, onComplete, onError]);

  // Get current progress from store
  const importProgress = eventId ? getImport(eventId) : undefined;

  return {
    progress: importProgress?.progress ?? 0,
    currentStep: importProgress?.currentStep ?? "",
    isImporting: importProgress?.isImporting ?? false,
  };
}

/**
 * Global listener for import progress events.
 * Should be used once at app level to track all imports.
 */
export function useGlobalImportProgressListener() {
  const { setImportProgress, updateImportProgress, clearImport } = useImportProgressStore();
  const listenerRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    const setupListener = async () => {
      listenerRef.current = await listen<EventPayload>("state_event", (event) => {
        const payload = event.payload;

        if (payload.event_type !== EventType.TaskProgress) return;

        const eventId = payload.event_id;
        const progress = payload.progress ?? 0;
        const step = payload.message || "";

        // Update or create import progress
        const { getImport } = useImportProgressStore.getState();
        const existing = getImport(eventId);

        if (existing) {
          updateImportProgress(eventId, progress, step);
        } else {
          setImportProgress(eventId, {
            fileName: "Modpack",
            progress,
            currentStep: step,
          });
        }

        // Clear on completion
        if (progress >= 100) {
          setTimeout(() => clearImport(eventId), 2000);
        }

        // Clear on error
        if (payload.error) {
          clearImport(eventId);
        }
      });
    };

    setupListener();

    return () => {
      if (listenerRef.current) {
        listenerRef.current();
        listenerRef.current = null;
      }
    };
  }, [setImportProgress, updateImportProgress, clearImport]);
}
