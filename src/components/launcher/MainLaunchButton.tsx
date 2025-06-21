"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "../../lib/utils";
import {
  LaunchState,
  useLaunchStateStore,
} from "../../store/launch-state-store";
import { Button } from "../ui/buttons/Button";
import { IconButton } from "../ui/buttons/IconButton";
import { ProfileSelectionModal } from "./ProfileSelectionModal";
import * as ProcessService from "../../services/process-service";
import { Event as TauriEvent, listen } from "@tauri-apps/api/event";
import { useThemeStore } from "../../store/useThemeStore";
import { useVersionSelectionStore } from "../../store/version-selection-store";
import { toast } from "react-hot-toast";
import {
  EventPayload as FrontendEventPayload,
  EventType as FrontendEventType,
} from "../../types/events";

interface Version {
  id: string;
  label: string;
  icon?: string;
  isCustom?: boolean;
  profileId?: string;
}

interface MainLaunchButtonProps {
  versions?: Version[];
  defaultVersion?: string;
  className?: string;
  onVersionChange?: (version: string) => void;
  maxWidth?: string;
  selectedVersionLabel?: string;
  mainButtonWidth?: string;
  mainButtonHeight?: string;
}

export function MainLaunchButton({
  defaultVersion,
  className,
  onVersionChange,
  versions,
  maxWidth = "300px",
  selectedVersionLabel,
  mainButtonWidth,
  mainButtonHeight,
}: MainLaunchButtonProps) {
  // Local state for transient success message styling (can be further integrated if needed)
  const [transientSuccessActive, setTransientSuccessActive] = useState(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const { selectedVersion, setSelectedVersion, openModal } =
    useVersionSelectionStore();

  const {
    initializeProfile,
    getProfileState,
    setLaunchError,
    resetLaunchState,
    initiateButtonLaunch,
    finalizeButtonLaunch,
    setButtonStatusMessage,
  } = useLaunchStateStore();

  // Get profile-specific launch state, including button state
  const profileState = getProfileState(selectedVersion);
  const {
    launchProgress,
    currentStep,
    error,
    logHistory,
    launchState,
    isButtonLaunching,
    buttonStatusMessage,
  } = profileState;

  useEffect(() => {
    const currentStoreVersion = selectedVersion;
    const storeVersionIsValidInProps = versions?.some(
      (v) => v.id === currentStoreVersion
    );

    if (defaultVersion) {
      if (
        !storeVersionIsValidInProps ||
        currentStoreVersion !== defaultVersion
      ) {
        const defaultVersionPropIsValidInProps = versions?.some(
          (v) => v.id === defaultVersion
        );
        if (defaultVersionPropIsValidInProps) {
          setSelectedVersion(defaultVersion);
        } else if (versions && versions.length > 0) {
          setSelectedVersion(versions[0].id);
        } else {
          setSelectedVersion("");
        }
      }
    } else {
      if (!storeVersionIsValidInProps) {
        if (versions && versions.length > 0) {
          setSelectedVersion(versions[0].id);
        } else {
          setSelectedVersion("");
        }
      }
    }
  }, [defaultVersion, versions, selectedVersion, setSelectedVersion]);

  // Effect for managing event listeners (game start/exit, detailed status)
  useEffect(() => {
    if (!selectedVersion) return;

    let unlistenStart: (() => void) | undefined;
    let unlistenDetailedStateEvent: (() => void) | undefined;

    const setupGameLifecycleListeners = async () => {
      unlistenStart = await listen("event", (event: TauriEvent<any>) => {
        const payload = event.payload as any;
        if (
          payload.target_id === selectedVersion &&
          payload.event_type?.toLowerCase() === "minecraft_output"
        ) {
          console.log(
            "[LaunchButton] Game started (minecraft_output) event, resetting UI if still launching."
          );
          if (isButtonLaunching) {
            finalizeButtonLaunch(selectedVersion);
          }
        }
      });
    };

    const setupDetailedListener = async () => {
      console.log(
        `[LaunchButton] Setting up detailed status listener for ${selectedVersion}`
      );
      unlistenDetailedStateEvent = await listen<FrontendEventPayload>(
        "state_event",
        (event: TauriEvent<FrontendEventPayload>) => {
          if (event.payload.target_id === selectedVersion) {
            const eventTypeFromPayload = event.payload.event_type;
            const eventMessage = event.payload.message;

            if (eventTypeFromPayload === FrontendEventType.LaunchSuccessful) {
              console.log(
                `[LaunchButton] LaunchSuccessful event for ${selectedVersion}`
              );
              finalizeButtonLaunch(selectedVersion);
              setButtonStatusMessage(selectedVersion, "STARTING!");
              setTransientSuccessActive(true);
              setTimeout(() => {
                setButtonStatusMessage(selectedVersion, null);
                setTransientSuccessActive(false);
              }, 3000);
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
            } else if (eventTypeFromPayload === FrontendEventType.Error) {
              console.log(
                `[LaunchButton] Error event via state_event for ${selectedVersion}, resetting UI.`
              );
              const eventErrorMsg =
                eventMessage || "Error during launch process.";
              toast.error(`Error: ${eventErrorMsg}`);
              setLaunchError(selectedVersion, eventErrorMsg);
            } else {
              if (eventMessage) {
                setButtonStatusMessage(selectedVersion, eventMessage);
              }
            }
          }
        }
      );
    };

    setupGameLifecycleListeners();
    if (isButtonLaunching) {
      setupDetailedListener();
      if (!buttonStatusMessage)
        setButtonStatusMessage(selectedVersion, "Initializing launch...");
    } else {
      if (unlistenDetailedStateEvent) unlistenDetailedStateEvent();
    }

    return () => {
      if (unlistenStart) unlistenStart();
      if (unlistenDetailedStateEvent) unlistenDetailedStateEvent();
    };
  }, [
    selectedVersion,
    isButtonLaunching,
    getProfileState,
    finalizeButtonLaunch,
    setButtonStatusMessage,
    setLaunchError,
  ]);

  // Effect for Polling 'is_profile_launching' status
  useEffect(() => {
    const clearPolling = () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        console.log("[LaunchButton] Polling stopped for", selectedVersion);
      }
    };

    if (isButtonLaunching && selectedVersion) {
      console.log(
        "[LaunchButton] Starting polling for launcher task finished for",
        selectedVersion
      );
      pollingIntervalRef.current = setInterval(async () => {
        try {
          const isStillPhysicallyLaunching = await invoke<boolean>(
            "is_profile_launching",
            { profileId: selectedVersion }
          );
          const launcherTaskFinished = !isStillPhysicallyLaunching;

          if (launcherTaskFinished) {
            console.log(
              "[LaunchButton] Polling determined launcher task finished for",
              selectedVersion
            );
            clearPolling();

            const currentProfileStateAfterPoll =
              getProfileState(selectedVersion);
            if (
              currentProfileStateAfterPoll.launchState === LaunchState.ERROR ||
              currentProfileStateAfterPoll.error
            ) {
              console.log(
                "[LaunchButton] Polling: Launch task finished, but an error was detected in store."
              );
              if (currentProfileStateAfterPoll.isButtonLaunching) {
                finalizeButtonLaunch(
                  selectedVersion,
                  currentProfileStateAfterPoll.error ||
                    "Unknown error after completion."
                );
              }
            } else {
              console.log(
                "[LaunchButton] Polling: Launch task finished successfully."
              );
              if (currentProfileStateAfterPoll.isButtonLaunching) {
                finalizeButtonLaunch(selectedVersion);
              }
            }
          }
        } catch (err: any) {
          console.error(
            "[LaunchButton] Error during polling is_profile_launching:",
            err
          );
          const pollErrorMsg =
            err.message ||
            err.toString() ||
            "Error while checking profile status.";
          toast.error(`Polling error: ${pollErrorMsg}`);
          finalizeButtonLaunch(selectedVersion, pollErrorMsg);
          clearPolling();
        }
      }, 1500);
    } else {
      clearPolling();
    }

    return clearPolling;
  }, [
    selectedVersion,
    isButtonLaunching,
    finalizeButtonLaunch,
    getProfileState,
    setButtonStatusMessage,
  ]);

  // Effect for initializing profile state (less frequent updates)
  useEffect(() => {
    if (selectedVersion) {
      initializeProfile(selectedVersion);
      const currentProfile = getProfileState(selectedVersion);
      if (currentProfile.isButtonLaunching) {
        console.log(
          "[LaunchButton] Init: MC not running, but button state is launching. Polling will handle."
        );
      }
    }
  }, [
    selectedVersion,
    initializeProfile,
    getProfileState,
    finalizeButtonLaunch,
  ]);

  const handleLaunch = async () => {
    if (!selectedVersion) return;

    const currentProfile = getProfileState(selectedVersion);

    if (currentProfile.isButtonLaunching) {
      try {
        setButtonStatusMessage(selectedVersion, "Attempting to abort...");
        await ProcessService.abort(selectedVersion);
        toast.success("Launch process aborted.");
        finalizeButtonLaunch(selectedVersion);
      } catch (err: any) {
        console.error("Failed to abort launch:", err);
        const abortErrorMsg =
          typeof err === "string"
            ? err
            : err.message || err.toString() || "Error during abort.";
        toast.error(`Abort failed: ${abortErrorMsg}`);
        finalizeButtonLaunch(selectedVersion, abortErrorMsg);
      }
      return;
    }

    initiateButtonLaunch(selectedVersion);

    try {
      await ProcessService.launch(selectedVersion);
    } catch (err: any) {
      console.error("Failed to launch profile:", err);
      const launchErrorMsg =
        typeof err === "string"
          ? err
          : err.message || err.toString() || "Unknown error during launch.";
      toast.error(`Launch failed: ${launchErrorMsg}`);
      setLaunchError(selectedVersion, launchErrorMsg);
    }
  };

  const handleVersionChange = (version: string) => {
    if (isButtonLaunching) return;
    setButtonStatusMessage(selectedVersion, null);
    if (onVersionChange) {
      onVersionChange(version);
    }
  };

  const handleOpenModal = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isButtonLaunching) return;
    openModal();
  };

  const getMainButtonIcon = () => {
    if (isButtonLaunching) {
      return <Icon icon="solar:stop-bold" width="24" height="24" />;
    }
    return <Icon icon="solar:play-bold" width="24" height="24" />;
  };

  const renderLaunchButtonContent = () => {
    const actionText = isButtonLaunching ? "STOP" : "LAUNCH";

    let statusSubText: string | null | undefined = null;
    let statusColorClass = "opacity-85";

    if (transientSuccessActive && buttonStatusMessage === "STARTING!") {
      statusSubText = buttonStatusMessage;
      statusColorClass = "text-green-400";
    } else if (isButtonLaunching) {
      statusSubText = buttonStatusMessage || currentStep || "Launching...";
      statusColorClass =
        buttonStatusMessage || currentStep
          ? "opacity-90 text-white"
          : "opacity-75";
    } else if (buttonStatusMessage && launchState === LaunchState.ERROR) {
      statusSubText = buttonStatusMessage;
      statusColorClass = "text-red-400";
    } else if (buttonStatusMessage) {
      statusSubText = buttonStatusMessage;
      statusColorClass = "opacity-85";
    }

    const displaySubText = statusSubText || selectedVersionLabel;
    return (
      <div className="w-full flex flex-col items-center justify-center leading-none -mt-4">
        <span className="text-5xl text-center lowercase">{actionText}</span>{" "}
        {displaySubText && (
          <span
            className={cn(
              "text-xs font-minecraft-ten tracking-normal -mt-1 text-center normal-case whitespace-nowrap overflow-hidden text-ellipsis",
              isButtonLaunching ? "max-w-64" : "",
              statusColorClass
            )}
            style={isButtonLaunching ? { maxWidth: "16rem" } : undefined}
            title={
              typeof displaySubText === "string" ? displaySubText : undefined
            }
          >
            {displaySubText}
          </span>
        )}
      </div>
    );
  };

  const getButtonVariant = () => {
    const currentProfile = getProfileState(selectedVersion);
    if (currentProfile.isButtonLaunching) {
      return "destructive";
    }
    return "3d";
  };

  return (
    <div
      className={cn("relative flex flex-col justify-center", className)}
      style={{ maxWidth }}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center relative">
          <Button
            onClick={handleLaunch}
            disabled={
              !selectedVersion ||
              (versions && versions.length === 0 && !selectedVersion)
            }
            size="xl"
            icon={undefined}
            variant={getButtonVariant()}
            className={cn("flex-1 rounded-r-none", mainButtonWidth)}
            heightClassName={mainButtonHeight}
          >
            {renderLaunchButtonContent()}
          </Button>

          <IconButton
            onClick={handleOpenModal}
            disabled={isButtonLaunching || !versions || versions.length === 0}
            size="xl"
            className={cn("rounded-l-none border-l-0", mainButtonHeight)}
            icon={
              <Icon icon="solar:alt-arrow-down-bold" width="24" height="24" />
            }
            variant={
              getButtonVariant() === "destructive" ? "destructive" : "3d"
            }
            aria-label="Select version"
          />
        </div>
      </div>

      {versions && (
        <ProfileSelectionModal
          onVersionChange={handleVersionChange}
          title="Select Version"
        />
      )}
    </div>
  );
}
