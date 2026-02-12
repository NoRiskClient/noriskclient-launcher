"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { Card } from "../ui/Card";
import {
  LaunchState,
  useLaunchStateStore,
} from "../../store/launch-state-store";

interface LaunchStatusProps {
  profileId: string;
  isLaunching: boolean;
  currentStep: string;
  progress: number;
  logHistory: string[];
  onAbort: () => void;
  className?: string;
  compact?: boolean;
}

export function LaunchStatus({
  profileId,
  isLaunching,
  currentStep,
  progress,
  logHistory,
  onAbort,
  className,
}: LaunchStatusProps) {
  const { t } = useTranslation();
  const logEndRef = useRef<HTMLDivElement>(null);
  const { getProfileState } = useLaunchStateStore();
  const profileState = getProfileState(profileId);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logHistory]);

  const getStatusIcon = () => {
    if (profileState.launchState === LaunchState.LAUNCHING) {
      return (
        <Icon
          icon="pixel:spinner-solid"
          className="w-5 h-5 mr-3 text-red-400 animate-spin flex-shrink-0"
        />
      );
    } else if (profileState.launchState === LaunchState.ERROR) {
      return (
        <Icon
          icon="pixel:exclamation-triangle-solid"
          className="w-5 h-5 mr-3 text-red-400 flex-shrink-0"
        />
      );
    } else {
      return (
        <Icon
          icon="pixel:check-solid"
          className="w-5 h-5 mr-3 text-green-400 flex-shrink-0"
        />
      );
    }
  };

  const getStatusText = () => {
    if (profileState.error) {
      return profileState.error;
    }
    return currentStep || t('launch.status.idle');
  };

  return (
    <Card
      className={cn(
        "w-full overflow-hidden bg-black/60 backdrop-blur-md",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center flex-1 min-w-0 px-3 py-2">
          {getStatusIcon()}
          <span className="text-sm font-minecraft text-white truncate">
            {getStatusText()}
          </span>
        </div>

        {isLaunching && (
          <button
            onClick={onAbort}
            className="px-3 py-2 text-red-400 hover:text-red-300 transition-colors"
            title={t('launch.status.abort')}
          >
            <Icon icon="pixel:x-solid" className="w-4 h-4" />
          </button>
        )}
      </div>

      {isLaunching && (
        <div className="w-full h-[3px] bg-black/40">
          <div
            className="h-full bg-red-400 transition-all duration-300"
            style={{ width: `${Math.max(1, progress * 100)}%` }}
          />
        </div>
      )}
    </Card>
  );
}
