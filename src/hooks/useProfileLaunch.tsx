"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { listen, Event as TauriEvent } from "@tauri-apps/api/event";
import { EventPayload as FrontendEventPayload, EventType as FrontendEventType } from "../types/events";
import { invoke } from "@tauri-apps/api/core";
import { LaunchState } from "../store/launch-state-store";
import { useLaunchStateStore, DEFAULT_PROFILE_STATE } from "../store/launch-state-store";
import * as ProcessService from "../services/process-service";
import type { LaunchOverrides } from "../services/process-service";
import { toast } from "react-hot-toast";
import i18n from "../i18n/i18n";
import { useGlobalModal } from "./useGlobalModal";
import { GroupMigrationModal } from "../components/modals/GroupMigrationModal";
import { checkForGroupMigration, getProfile } from "../services/profile-service";
import { MigrationInfo } from "../types/profile";
import * as SyncPackService from "../services/sync-pack-service";
import { needsAdoptConfirm } from "../types/syncPacks";
import { AdoptPreviewModal } from "../components/sync-packs/AdoptPreviewModal";
import { requireMinecraftAccount } from "../lib/require-account";
import { useProfileStore } from "../store/profile-store";
import { parseErrorMessage } from "../utils/error-utils";

const preparingProfiles = new Set<string>();
const preparationListeners = new Set<() => void>();
const subscribeToPreparation = (listener: () => void) => {
  preparationListeners.add(listener);
  return () => preparationListeners.delete(listener);
};
function setPreparingProfile(profileId: string, preparing: boolean) {
  if (preparing === preparingProfiles.has(profileId)) return;
  if (preparing) preparingProfiles.add(profileId);
  else preparingProfiles.delete(profileId);
  preparationListeners.forEach(listener => listener());
}

interface UseProfileLaunchOptions {
  profileId: string;
  quickPlaySingleplayer?: string;
  quickPlayMultiplayer?: string;
  onLaunchSuccess?: () => void;
  onLaunchError?: (error: string) => void;
  skipLastPlayedUpdate?: boolean;
}

export function useProfileLaunch(options: UseProfileLaunchOptions) {
  const { profileId, quickPlaySingleplayer, quickPlayMultiplayer, onLaunchSuccess, onLaunchError, skipLastPlayedUpdate } = options;

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPreparing = useSyncExternalStore(subscribeToPreparation,
    () => preparingProfiles.has(profileId), () => false);
  const { showModal, hideModal } = useGlobalModal();


  const getProfileState = useLaunchStateStore((s) => s.getProfileState);
  const initializeProfile = useLaunchStateStore((s) => s.initializeProfile);
  const initiateButtonLaunch = useLaunchStateStore((s) => s.initiateButtonLaunch);
  const finalizeButtonLaunch = useLaunchStateStore((s) => s.finalizeButtonLaunch);
  const setButtonStatusMessage = useLaunchStateStore((s) => s.setButtonStatusMessage);
  const setLaunchError = useLaunchStateStore((s) => s.setLaunchError);

  const { isButtonLaunching, buttonStatusMessage, launchState } =
    useLaunchStateStore((s) => s.profiles[profileId] ?? DEFAULT_PROFILE_STATE);

  // Initialize profile on mount
  useEffect(() => {
    initializeProfile(profileId);
  }, [profileId, initializeProfile]);

  // Event listener for detailed launch status
  useEffect(() => {
    let unlistenStateEvent: (() => void) | undefined;

    const setupDetailedListener = async () => {
      console.log(`[useProfileLaunch] Setting up detailed status listener for ${profileId}`);
      unlistenStateEvent = await listen<FrontendEventPayload>(
        "state_event",
        (event: TauriEvent<FrontendEventPayload>) => {
          if (event.payload.target_id === profileId) {
            const eventTypeFromPayload = event.payload.event_type;
            const eventMessage = event.payload.message;

            if (eventTypeFromPayload === FrontendEventType.LaunchSuccessful) {
              console.log(`[useProfileLaunch] LaunchSuccessful event for ${profileId}`);
              finalizeButtonLaunch(profileId);
              setButtonStatusMessage(profileId, i18n.t('launch.starting'));
              setTimeout(() => {
                setButtonStatusMessage(profileId, null);
              }, 3000);
              onLaunchSuccess?.();
            } else if (eventTypeFromPayload === FrontendEventType.Error) {
              console.log(`[useProfileLaunch] Error event via state_event for ${profileId}`);
              const eventErrorMsg = eventMessage || i18n.t('launch.error.unknown');
              toast.error(i18n.t('launch.error', { error: eventErrorMsg }), { id: `launch-error-${profileId}` });
              setLaunchError(profileId, eventErrorMsg);
              onLaunchError?.(eventErrorMsg);
            } else {
              if (eventMessage) {
                setButtonStatusMessage(profileId, eventMessage);
              }
            }
          }
        }
      );
    };

    if (isButtonLaunching) {
      setupDetailedListener();
    }

    return () => {
      if (unlistenStateEvent) {
        unlistenStateEvent();
      }
    };
  }, [profileId, isButtonLaunching, finalizeButtonLaunch, setButtonStatusMessage, setLaunchError, onLaunchSuccess, onLaunchError, quickPlaySingleplayer, quickPlayMultiplayer]);

  // Polling for launch status
  useEffect(() => {
    const clearPolling = () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        console.log(`[useProfileLaunch] Polling stopped for ${profileId}`);
      }
    };

    if (isButtonLaunching && profileId) {
      console.log(`[useProfileLaunch] Starting polling for launcher task finished for ${profileId}`);
      pollingIntervalRef.current = setInterval(async () => {
        try {
          const isStillPhysicallyLaunching = await invoke<boolean>(
            "is_profile_launching",
            { profileId }
          );
          const launcherTaskFinished = !isStillPhysicallyLaunching;

          if (launcherTaskFinished) {
            console.log(`[useProfileLaunch] Polling determined launcher task finished for ${profileId}`);
            clearPolling();

            const currentProfileStateAfterPoll = getProfileState(profileId);
            if (
              currentProfileStateAfterPoll.launchState === LaunchState.ERROR ||
              currentProfileStateAfterPoll.error
            ) {
              console.log(`[useProfileLaunch] Polling: Launch task finished, but an error was detected in store.`);
              if (currentProfileStateAfterPoll.isButtonLaunching) {
                finalizeButtonLaunch(
                  profileId,
                  currentProfileStateAfterPoll.error || "Unknown error after completion."
                );
              }
            } else {
              console.log(`[useProfileLaunch] Polling: Launch task finished successfully.`);
              if (currentProfileStateAfterPoll.isButtonLaunching) {
                finalizeButtonLaunch(profileId);
              }
            }
          }
        } catch (err: any) {
          console.error(`[useProfileLaunch] Error during polling is_profile_launching:`, err);
          const pollErrorMsg =
            err.message || err.toString() || "Error while checking profile status.";
          toast.error(i18n.t('launch.polling_error', { error: pollErrorMsg }), { id: `launch-error-${profileId}` });
          finalizeButtonLaunch(profileId, pollErrorMsg);
          clearPolling();
        }
      }, 1500);
    } else {
      clearPolling();
    }

    return clearPolling;
  }, [profileId, isButtonLaunching, finalizeButtonLaunch, getProfileState, quickPlaySingleplayer, quickPlayMultiplayer]);

  const ensureSyncConfirmed = async (): Promise<boolean> => {
    try {
      const profile = await getProfile(profileId);
      const packIds = profile.sync_pack_ids ?? [];
      if (packIds.length === 0) return true;

      const preview = await SyncPackService.previewProfileSync(profileId, packIds);
      const adopting = preview.filter(needsAdoptConfirm);
      if (adopting.length === 0) return true;

      const packNames = Array.from(
        new Set(adopting.map((entry) => entry.pack_name)),
      ).join(", ");

      return await new Promise<boolean>((resolve) => {
        const modalId = `sync-adopt-${profileId}`;
        showModal(
          modalId,
          <AdoptPreviewModal
            profileName={profile.name}
            packName={packNames}
            entries={adopting}
            onCancel={() => {
              hideModal(modalId);
              resolve(false);
            }}
            onConfirm={() => {
              hideModal(modalId);
              resolve(true);
            }}
          />,
        );
      });
    } catch (err) {
      console.warn("[useProfileLaunch] Sync pack preflight failed:", err);
      toast.error(i18n.t('launch.preflight_failed', {
        defaultValue: 'Could not prepare launch: {{error}}', error: parseErrorMessage(err),
      }), { id: `launch-error-${profileId}` });
      return false;
    }
  };

  // Sign-in gate. Without an account the backend aborts the launch with a bare
  // NoCredentialsError, so catch it here and offer the sign-in instead; the
  // prompt calls `retry` once an account is active so the click still lands.
  const hasAccountOrPrompt = (retry: () => void): boolean =>
    requireMinecraftAccount({
      profileName: useProfileStore.getState().profiles.find((p) => p.id === profileId)?.name,
      onAuthenticated: retry,
    });

  const performLaunch = async (
    migrationInfo: MigrationInfo | undefined,
    singleplayer?: string,
    multiplayer?: string,
    overrides?: LaunchOverrides,
  ) => {
    initiateButtonLaunch(profileId);
    try {
      await ProcessService.launch(profileId, singleplayer, multiplayer, migrationInfo, skipLastPlayedUpdate, overrides);
    } catch (error) {
      const message = parseErrorMessage(error);
      toast.error(i18n.t('launch.failed', { error: message }), { id: `launch-error-${profileId}` });
      setLaunchError(profileId, message);
      onLaunchError?.(message);
    }
  };

  const handleRequestedLaunch = async (
    singleplayer?: string,
    multiplayer?: string,
    overrides?: LaunchOverrides,
  ) => {
    // Shared across Hero, World, Server and card hook instances. A preflight
    // is not a native launch and must neither duplicate nor trigger abort.
    if (preparingProfiles.has(profileId)) return;
    const currentProfile = getProfileState(profileId);
    if (currentProfile.isButtonLaunching) {
      try {
        setButtonStatusMessage(profileId, i18n.t('launch.stopping'));
        await new Promise(resolve => setTimeout(resolve, 0));
        await ProcessService.abort(profileId);
        toast.success(i18n.t('launch.stopped'));
        finalizeButtonLaunch(profileId);
      } catch (error) {
        const message = parseErrorMessage(error);
        toast.error(i18n.t('launch.stop_failed', { message }), { id: `launch-error-${profileId}` });
        finalizeButtonLaunch(profileId, message);
      }
      return;
    }
    if (!hasAccountOrPrompt(() => void handleRequestedLaunch(singleplayer, multiplayer, overrides))) return;

    setPreparingProfile(profileId, true);
    try {
      if (!(await ensureSyncConfirmed())) return;
      let migrationInfo: MigrationInfo | undefined;
      // Overrides intentionally keep their existing direct-launch path.
      if (!overrides) {
        const migration = await checkForGroupMigration(profileId);
        if (migration.direction !== 'None') {
          const modalId = `group-migration-${profileId}${singleplayer || multiplayer ? '-quickplay' : ''}`;
          const decision = await new Promise<MigrationInfo | undefined | null>(resolve => {
            let settled = false;
            const choose = (value: MigrationInfo | undefined | null) => {
              if (settled) return;
              settled = true;
              hideModal(modalId);
              resolve(value);
            };
            showModal(modalId,
              <GroupMigrationModal isOpen={true} profileId={profileId} migrationInfo={migration}
                onClose={() => choose(null)} onLaunch={() => choose(undefined)}
                onMigrate={() => choose(migration)} />
            );
          });
          if (decision === null) return;
          migrationInfo = decision;
        }
      }
      // Only native launch state enables Stop/abort/polling. Preparation has
      // its own truthful UI state and ends immediately before this boundary.
      setPreparingProfile(profileId, false);
      await performLaunch(migrationInfo, singleplayer, multiplayer, overrides);
    } catch (error) {
      const message = parseErrorMessage(error);
      toast.error(i18n.t('launch.preflight_failed', {
        defaultValue: 'Could not prepare launch: {{error}}', error: message,
      }), { id: `launch-error-${profileId}` });
      onLaunchError?.(message);
      // An unknown migration/sync status is not permission to launch anyway.
    } finally {
      setPreparingProfile(profileId, false);
    }
  };

  return {
    isLaunching: isButtonLaunching,
    isPreparing,
    isBusy: isButtonLaunching || isPreparing,
    statusMessage: isPreparing
      ? i18n.t('launch.preparing', { defaultValue: 'Checking launch requirements...' })
      : buttonStatusMessage,
    launchState,
    handleLaunch: () => handleRequestedLaunch(quickPlaySingleplayer, quickPlayMultiplayer),
    handleQuickPlayLaunch: handleRequestedLaunch,
  };
}
