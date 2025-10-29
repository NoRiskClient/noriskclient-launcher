"use client";

import { useEffect, useRef } from "react";
import { listen, Event as TauriEvent } from "@tauri-apps/api/event";
import { EventPayload as FrontendEventPayload, EventType as FrontendEventType } from "../types/events";
import { invoke } from "@tauri-apps/api/core";
import { LaunchState } from "../store/launch-state-store";
import { useLaunchStateStore } from "../store/launch-state-store";
import * as ProcessService from "../services/process-service";
import { toast } from "react-hot-toast";
import { useGlobalModal } from "./useGlobalModal";
import { GroupMigrationModal } from "../components/modals/GroupMigrationModal";
import { checkForGroupMigration } from "../services/profile-service";
import { MigrationInfo } from "../types/profile";

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
  const { showModal, hideModal } = useGlobalModal();


  const {
    getProfileState,
    initializeProfile,
    initiateButtonLaunch,
    finalizeButtonLaunch,
    setButtonStatusMessage,
    setLaunchError,
  } = useLaunchStateStore();

  const { isButtonLaunching, buttonStatusMessage, launchState } = getProfileState(profileId);

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
              setButtonStatusMessage(profileId, "STARTING!");
              setTimeout(() => {
                setButtonStatusMessage(profileId, null);
              }, 3000);
              onLaunchSuccess?.();
            } else if (eventTypeFromPayload === FrontendEventType.Error) {
              console.log(`[useProfileLaunch] Error event via state_event for ${profileId}`);
              const eventErrorMsg = eventMessage || "Error during launch process.";
              toast.error(`Error: ${eventErrorMsg}`);
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
          toast.error(`Polling error: ${pollErrorMsg}`);
          finalizeButtonLaunch(profileId, pollErrorMsg);
          clearPolling();
        }
      }, 1500);
    } else {
      clearPolling();
    }

    return clearPolling;
  }, [profileId, isButtonLaunching, finalizeButtonLaunch, getProfileState, quickPlaySingleplayer, quickPlayMultiplayer]);

  // Actual launch function
  const performLaunch = async (migrationInfo?: MigrationInfo) => {
    initiateButtonLaunch(profileId);

    try {
      await ProcessService.launch(profileId, quickPlaySingleplayer, quickPlayMultiplayer, migrationInfo, skipLastPlayedUpdate);
    } catch (err: any) {
      console.error("Failed to launch profile:", err);
      const launchErrorMsg =
        typeof err === "string"
          ? err
          : err.message || err.toString() || "Unknown error during launch.";
      toast.error(`Launch failed: ${launchErrorMsg}`);
      setLaunchError(profileId, launchErrorMsg);
      onLaunchError?.(launchErrorMsg);
    }
  };

  // Migration handler
  const handleMigration = async (migrationInfo: MigrationInfo) => {
    console.log(`[useProfileLaunch] Starting migration for profile ${profileId}`, migrationInfo);

    // Close modal and launch with migration info (migration will happen in installer)
    hideModal(`group-migration-${profileId}`);
    performLaunch(migrationInfo);
  };

  // Launch handler with abort functionality
  const handleLaunch = async () => {
    const currentProfile = getProfileState(profileId);

    if (currentProfile.isButtonLaunching) {
      try {
        setButtonStatusMessage(profileId, "Attempting to stop...");
        await ProcessService.abort(profileId);
        toast.success("Launch process stopped.");
        finalizeButtonLaunch(profileId);
      } catch (err: any) {
        console.error("Failed to abort launch:", err);
        const abortErrorMsg =
          typeof err === "string"
            ? err
            : err.message || err.toString() || "Error during abort.";
        toast.error(`Stop failed: ${abortErrorMsg}`);
        finalizeButtonLaunch(profileId, abortErrorMsg);
      }
      return;
    }

    // Check if migration is needed
    try {
      const migrationInfo: MigrationInfo = await checkForGroupMigration(profileId);

      if (migrationInfo.direction === 'None') {
        // No migration needed, launch directly
        performLaunch(undefined);
        return;
      }

      // Show GroupMigrationModal before launching
      showModal(
        `group-migration-${profileId}`,
        <GroupMigrationModal
          isOpen={true}
          onClose={() => hideModal(`group-migration-${profileId}`)}
          onLaunch={() => {
            hideModal(`group-migration-${profileId}`);
            performLaunch(undefined);
          }}
          onMigrate={() => handleMigration(migrationInfo)}
          profileId={profileId}
        />
      );
    } catch (err: any) {
      console.error("Failed to check migration status:", err);
      // If migration check fails, proceed with normal launch
      performLaunch(undefined);
    }
  };

  return {
    isLaunching: isButtonLaunching,
    statusMessage: buttonStatusMessage,
    launchState,
    handleLaunch,
    handleQuickPlayLaunch: async (singleplayer?: string, multiplayer?: string) => {
      const currentProfile = getProfileState(profileId);

      if (currentProfile.isButtonLaunching) {
        try {
          setButtonStatusMessage(profileId, "Attempting to stop...");
          await ProcessService.abort(profileId);
          toast.success("Launch process stopped.");
          finalizeButtonLaunch(profileId);
        } catch (err: any) {
          console.error("Failed to abort launch:", err);
          const abortErrorMsg =
            typeof err === "string"
              ? err
              : err.message || err.toString() || "Error during abort.";
          toast.error(`Stop failed: ${abortErrorMsg}`);
          finalizeButtonLaunch(profileId, abortErrorMsg);
        }
        return;
      }

      // Check if migration is needed
      try {
        const migrationInfo: MigrationInfo = await checkForGroupMigration(profileId);

        if (migrationInfo.direction === 'None') {
          // No migration needed, launch directly
          initiateButtonLaunch(profileId);
          try {
            await ProcessService.launch(profileId, singleplayer, multiplayer, undefined, skipLastPlayedUpdate);
          } catch (err: any) {
            console.error("Failed to launch profile:", err);
            const launchErrorMsg =
              typeof err === "string"
                ? err
                : err.message || err.toString() || "Unknown error during launch.";
            toast.error(`Launch failed: ${launchErrorMsg}`);
            setLaunchError(profileId, launchErrorMsg);
            onLaunchError?.(launchErrorMsg);
          }
          return;
        }

        // Show GroupMigrationModal before launching
        showModal(
          `group-migration-${profileId}-quickplay`,
          <GroupMigrationModal
            isOpen={true}
            onClose={() => hideModal(`group-migration-${profileId}-quickplay`)}
            onLaunch={() => {
              hideModal(`group-migration-${profileId}-quickplay`);
              initiateButtonLaunch(profileId);

              try {
                ProcessService.launch(profileId, singleplayer, multiplayer, undefined, skipLastPlayedUpdate);
              } catch (err: any) {
                console.error("Failed to launch profile:", err);
                const launchErrorMsg =
                  typeof err === "string"
                    ? err
                    : err.message || err.toString() || "Unknown error during launch.";
                toast.error(`Launch failed: ${launchErrorMsg}`);
                setLaunchError(profileId, launchErrorMsg);
                onLaunchError?.(launchErrorMsg);
              }
            }}
            onMigrate={() => {
              console.log(`[useProfileLaunch] Starting migration for quickplay ${profileId}`, migrationInfo);

              // Close modal and launch with migration info
              hideModal(`group-migration-${profileId}-quickplay`);

              // Launch with migration info (will handle migration in install_minecraft_version)
              const performQuickPlayLaunch = async () => {
                initiateButtonLaunch(profileId);
                await ProcessService.launch(profileId, singleplayer, multiplayer, migrationInfo, skipLastPlayedUpdate);
              };
              performQuickPlayLaunch();
            }}
            profileId={profileId}
          />
        );
      } catch (err: any) {
        console.error("Failed to check migration status:", err);
        // If migration check fails, proceed with normal launch
        initiateButtonLaunch(profileId);
        try {
          await ProcessService.launch(profileId, singleplayer, multiplayer, undefined, skipLastPlayedUpdate);
        } catch (err: any) {
          console.error("Failed to launch profile:", err);
          const launchErrorMsg =
            typeof err === "string"
              ? err
              : err.message || err.toString() || "Unknown error during launch.";
          toast.error(`Launch failed: ${launchErrorMsg}`);
          setLaunchError(profileId, launchErrorMsg);
          onLaunchError?.(launchErrorMsg);
        }
      }
    },
  };
}
