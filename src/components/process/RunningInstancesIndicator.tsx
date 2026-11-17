import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
import * as ProcessService from "../../services/process-service";
import type { ProcessMetadata } from "../../types/processState";
import { Button } from "../ui/./buttons/Button";
import { invoke } from "@tauri-apps/api/core";

interface RunningInstancesIndicatorProps {
  className?: string;
}

export function RunningInstancesIndicator({
  className,
}: RunningInstancesIndicatorProps) {
  const { t } = useTranslation();
  const [processes, setProcesses] = useState<ProcessMetadata[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchProcesses = useCallback(async () => {
    try {
      const fetchedProcesses = await ProcessService.getRunningProcesses();
      setProcesses(fetchedProcesses);
    } catch (err) {
      console.error(err);
      setProcesses([]);
    } finally {
      if (isLoading) setIsLoading(false);
    }
  }, [isLoading]);

  useEffect(() => {
    fetchProcesses();

    const intervalId = setInterval(fetchProcesses, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [fetchProcesses]);

  const handleOpenLogWindow = async () => {
    try {
      await invoke("open_minecraft_log_window", { crashedProcess: null });
    } catch (err) {
      console.error("Failed to open log window:", err);
    }
  };

  const instanceCount = processes.length;
  const hasInstances = instanceCount > 0;

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Button
          variant={hasInstances ? "success" : "flat"}
          size="sm"
          onClick={handleOpenLogWindow}
          icon={<Icon icon="solar:monitor-bold" className="w-4 h-4" />}
          className="h-10"
        >
          {isLoading && instanceCount === 0
            ? t('instances.loading')
            : instanceCount === 0
              ? t('instances.no_instances')
              : `${instanceCount} ${t('common.instance', { count: instanceCount })}`}
        </Button>
      </div>
    </div>
  );
}
