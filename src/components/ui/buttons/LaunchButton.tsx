import React, { useState, useEffect, useRef } from "react";
import { Icon } from "@iconify/react";
import { Button } from "./Button";
import { toast } from "react-hot-toast";
import { listen, Event as TauriEvent } from "@tauri-apps/api/event";
import { EventPayload as FrontendEventPayload, EventType as FrontendEventType } from "../../../types/events";
import * as ProcessService from "../../../services/process-service";
import * as ProfileService from "../../../services/profile-service";
import { useLaunchStateStore, LaunchState } from "../../../store/launch-state-store";
import { 
  getAccessibilityProps,
  type ComponentSize,
  type ComponentVariant
} from "../design-system";

interface LaunchButtonProps {
  id: string;
  name: string;
  buttonText?: string;
  cancelText?: string;
  variant?: ComponentVariant;
  size?: ComponentSize;
  className?: string;
  disabled?: boolean;
  quickPlaySingleplayer?: string;
  quickPlayMultiplayer?: string;
  isIconOnly?: boolean;
  forceDisplaySpinner?: boolean;
  ariaLabel?: string;
}

export function LaunchButton({
  id,
  name,
  buttonText = "LAUNCH GAME",
  cancelText = "CANCEL",
  variant = "default",
  size = "md",
  className,
  disabled = false,
  quickPlaySingleplayer,
  quickPlayMultiplayer,
  isIconOnly = false,
  forceDisplaySpinner = false,
  ariaLabel,
}: LaunchButtonProps) {
  const [isButtonDisabledBriefly, setIsButtonDisabledBriefly] = useState(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const accessibilityProps = getAccessibilityProps({
    label: ariaLabel || `Launch ${name}`,
    disabled: disabled || isButtonDisabledBriefly
  });

  const {
    getProfileState,
    initiateButtonLaunch,
    finalizeButtonLaunch,
    setButtonStatusMessage,
    setLaunchError,
    initializeProfile,
  } = useLaunchStateStore();

  const { isButtonLaunching, buttonStatusMessage: storeButtonStatusMessage, launchState } = getProfileState(id);

  useEffect(() => {
    initializeProfile(id);

    const currentStoreState = getProfileState(id);
    if (!currentStoreState.isButtonLaunching) {
      ProfileService.isProfileLaunching(id)
        .then((currentlyPhysicallyLaunching) => {
          if (currentlyPhysicallyLaunching) {
            console.log(
              `[LaunchButton ${id}] Initial check: Backend says profile is launching. Updating store.`,
            );
            initiateButtonLaunch(id);
            setButtonStatusMessage(id, "Launching...");
          }
        })
        .catch((err) => {
          console.error(
            `[LaunchButton ${id}] Error checking initial physical launch state:`,
            err,
          );
        });
    }
  }, [id, initializeProfile, getProfileState, initiateButtonLaunch, setButtonStatusMessage]);

  useEffect(() => {
    console.log(`[LaunchButton ${id}] Setting up state_event listener. Current isButtonLaunching: ${isButtonLaunching}`);
    let isMounted = true;

    const handleStateEvent = (event: TauriEvent<FrontendEventPayload>) => {
      if (!isMounted) return;
      const payload = event.payload;

      if (payload.target_id === id) {
        if (payload.event_type === FrontendEventType.LaunchSuccessful) {
          console.log(`[LaunchButton ${id}] Event: LaunchSuccessful`);
          toast.success(`Profile '${name}' launched successfully!`);
          finalizeButtonLaunch(id);
          setButtonStatusMessage(id, "Launched!");
          setTimeout(() => setButtonStatusMessage(id, null), 3000);
          stopPolling();
        } else if (payload.event_type === FrontendEventType.Error) {
          const errorMessage =
            payload.message || "An unknown error occurred during launch.";
          console.error(
            `[LaunchButton ${id}] Event: Error - ${errorMessage}`,
          );
          toast.error(errorMessage);
          setLaunchError(id, errorMessage);
          stopPolling();
        } else if (payload.message) {
          setButtonStatusMessage(id, payload.message);
        }
      }
    };

    const unlistenPromise = listen<FrontendEventPayload>("state_event", handleStateEvent);

    const cleanupListener = async () => {
      if (!isMounted) return;
      isMounted = false;
      console.log(`[LaunchButton ${id}] Cleaning up state_event listener.`);
      try {
        const unlistenFunc = await unlistenPromise;
        unlistenFunc();
      } catch (error) {
        console.error(`[LaunchButton ${id}] Error during state_event listener cleanup:`, error);
      }
    };

    return () => {
      cleanupListener();
    };
  }, [id, name, finalizeButtonLaunch, setButtonStatusMessage, setLaunchError, getProfileState]);

  useEffect(() => {
    if (!id) return;

    if (isButtonLaunching) {
      console.log(`[LaunchButton ${id}] Starting polling for is_profile_launching (global state is true).`);
      pollingIntervalRef.current = setInterval(async () => {
        try {
          const isStillPhysicallyLaunching = await ProfileService.isProfileLaunching(id);
          const currentProfileState = getProfileState(id);

          if (!isStillPhysicallyLaunching && currentProfileState.isButtonLaunching) {
            console.log(
              `[LaunchButton ${id}] Polling: Backend reports profile is NOT launching, but store state IS launching. Resetting store state.`,
            );
            if (currentProfileState.error) {
                finalizeButtonLaunch(id, currentProfileState.error);
            } else {
                finalizeButtonLaunch(id);
            }
            stopPolling();
          } else if (!isStillPhysicallyLaunching && !currentProfileState.isButtonLaunching) {
            stopPolling();
          }
        } catch (err: any) {
          console.error(`[LaunchButton ${id}] Error during is_profile_launching polling:`, err);
          toast.error(`Polling error: ${err.message || "Unknown error"}`);
          if (getProfileState(id).isButtonLaunching) {
            setLaunchError(id, `Polling failed: ${err.message || "Unknown error"}`);
          }
          stopPolling();
        }
      }, 2000);
    } else {
      stopPolling();
    }

    return () => stopPolling();
  }, [id, isButtonLaunching, getProfileState, finalizeButtonLaunch, setLaunchError]);

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      console.log(`[LaunchButton ${id}] Polling for is_profile_launching stopped.`);
    }
  };

  const temporarilyDisableButton = () => {
    setIsButtonDisabledBriefly(true);
    setTimeout(() => {
      setIsButtonDisabledBriefly(false);
    }, 500);
  };

  const handlePlay = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!id || isButtonDisabledBriefly) return;

    temporarilyDisableButton();
    const currentProfileState = getProfileState(id);

    if (currentProfileState.isButtonLaunching) {
      try {
        setButtonStatusMessage(id, "Attempting to abort...");
        await ProcessService.abort(id);
        toast.success("Launch cancellation requested.");
        finalizeButtonLaunch(id);
      } catch (error) {
        console.error("Failed to request launch cancellation:", error);
        const message = error instanceof Error ? error.message : "Failed to cancel launch";
        toast.error(`Cancellation request failed: ${message}`);
        setLaunchError(id, `Abort failed: ${message}`);
      }
      return;
    }

    console.log(`[LaunchButton ${id}] Initiating new launch via store.`);
    initiateButtonLaunch(id);

    try {
      await ProcessService.launch(id, quickPlaySingleplayer, quickPlayMultiplayer);
      if (quickPlaySingleplayer || quickPlayMultiplayer) {
        console.warn("[LaunchButton] Quick play options are used, ensure backend supports them.");
      }
    } catch (error) {
      console.error("Failed to initiate launch:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to launch";
      toast.error(`Launch initiation failed: ${errorMessage}`);
      setLaunchError(id, `Launch failed: ${errorMessage}`);
    }
  };

  const actualIsLaunching = forceDisplaySpinner || isButtonLaunching;
  const currentButtonText = actualIsLaunching ? cancelText : buttonText;
  const buttonVariant = actualIsLaunching ? "destructive" : variant;

  if (isIconOnly) {
    const iconToShow = actualIsLaunching ? (
      <Icon icon="eos-icons:loading" width="60%" height="60%" />
    ) : (
      <Icon icon="solar:play-bold" width="60%" height="60%" />
    );    return (
      <button
        onClick={!disabled && !isButtonDisabledBriefly ? handlePlay : undefined}
        className={`flex w-full h-full items-center justify-center transition-opacity ${
          (disabled || isButtonDisabledBriefly) ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
        } ${className || ""}`}
        disabled={disabled || isButtonDisabledBriefly}
        tabIndex={disabled || isButtonDisabledBriefly ? -1 : 0}
        onKeyDown={(e) => {
          if (!disabled && !isButtonDisabledBriefly && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            handlePlay(e as any);
          }
        }}
        {...accessibilityProps}
      >
        {iconToShow}
      </button>
    );
  }
  return (
    <Button
      onClick={handlePlay}
      variant={buttonVariant}
      size={size}
      className={className}
      disabled={disabled || isButtonDisabledBriefly}
      label={actualIsLaunching ? `Cancel launch for ${name}` : `Launch ${name}`}
      icon={
        actualIsLaunching ? (
          <Icon
            icon="eos-icons:loading"
            className="w-5 h-5 text-white"
            aria-hidden="true"
          />
        ) : (
          <Icon 
            icon="solar:play-bold" 
            className="w-4 h-4 text-white"
            aria-hidden="true"
          />
        )
      }
      {...accessibilityProps}
    >
      {currentButtonText}
    </Button>
  );
}