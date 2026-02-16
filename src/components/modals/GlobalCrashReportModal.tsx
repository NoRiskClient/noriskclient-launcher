import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { useCrashModalStore } from '../../store/crash-modal-store';
import { Button } from '../ui/buttons/Button';
import { Icon } from '@iconify/react';
import { toast } from 'react-hot-toast';
import { getProfile, getProfileLatestLogContent } from '../../services/profile-service';
import { uploadLogToMclogs } from '../../services/log-service';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { submitCrashLog, fetchCrashReport } from '../../services/process-service';
import type { CrashlogDto } from '../../types/processState';
import { openExternalUrl } from '../../services/tauri-service';
import { Window } from '@tauri-apps/api/window';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { EventPayload, CrashReportContentAvailablePayload } from '../../types/events';
import { EventType } from '../../types/events';

export function GlobalCrashReportModal() {
  const { t } = useTranslation();
  const { isCrashModalOpen, crashData, closeCrashModal } = useCrashModalStore();
  const [profileName, setProfileName] = useState<string>('');
  const [mclogsUrl, setMclogsUrl] = useState<string | null>(null);
  const [noriskReportSubmitted, setNoriskReportSubmitted] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [displayedCrashReportContent, setDisplayedCrashReportContent] = useState<string | undefined>(undefined);
  const [isListeningForCrashContent, setIsListeningForCrashContent] = useState(false);
  const hasFetchedCrashReportRef = React.useRef(false);

  useEffect(() => {
    if (crashData?.profile_id) {
      if (crashData.process_metadata?.profile_name) {
        setProfileName(crashData.process_metadata.profile_name);
      } else {
        setProfileName(crashData.profile_id);
        getProfile(crashData.profile_id)
          .then(details => {
            if (details?.name) {
              setProfileName(details.name);
            }
          })
          .catch(err => {
            console.error(`Failed to fetch profile details for ${crashData.profile_id}:`, err);
          });
      }
      setMclogsUrl(null);
      setNoriskReportSubmitted(false);
      setIsProcessing(false);
      setDisplayedCrashReportContent(crashData.crash_report_content);
      setIsListeningForCrashContent(false);
      hasFetchedCrashReportRef.current = false; // Reset fetch flag for new crash
    } else {
      setProfileName('');
      setMclogsUrl(null);
      setNoriskReportSubmitted(false);
      setIsProcessing(false);
      setDisplayedCrashReportContent(undefined);
      setIsListeningForCrashContent(false);
      hasFetchedCrashReportRef.current = false; // Reset fetch flag
    }
  }, [crashData]);

  useEffect(() => {
    const focusRelevantWindow = async () => {
      if (isCrashModalOpen && crashData?.process_id) {
        const crashedProcessId = crashData.process_id;
        console.log(`Crash modal open for process ${crashedProcessId}. Opening/focusing log window.`);

        // Try to find existing single log window for this process
        const singleLogWindowLabel = `single_log_window_${crashedProcessId}`;
        let foundLogWindow = false;

        try {
          const singleLogWindow = await Window.getByLabel(singleLogWindowLabel);
          if (singleLogWindow) {
            console.log(`Focusing existing single log window: ${singleLogWindowLabel}`);
            await singleLogWindow.show();
            await singleLogWindow.unminimize();
            await singleLogWindow.setFocus();
            foundLogWindow = true;
          }
        } catch (e) {
          // Single log window not found, try main log window
        }

        if (!foundLogWindow) {
          // Open main log window with crashed process info
          try {
            console.log("Opening minecraft log window for crashed process");
            const processMetadata = crashData.process_metadata;
            if (processMetadata) {
              // Pass crashed process as JSON so log window can show it
              await invoke("open_minecraft_log_window", {
                crashedProcess: JSON.stringify({
                  ...processMetadata,
                  id: crashedProcessId,
                  state: { Crashed: { exit_code: crashData.exit_code } }
                })
              });
            } else {
              await invoke("open_minecraft_log_window", { crashedProcess: null });
            }
          } catch (e) {
            console.error("Failed to open log window for crash:", e);
          }
        }

        // Also focus main window
        try {
          const mainWindowInstance = await Window.getByLabel('main');
          if (mainWindowInstance) {
            console.log("Focusing main application window.");
            await mainWindowInstance.show();
            await mainWindowInstance.unminimize();
            await mainWindowInstance.setFocus();
          }
        } catch (e) {
          console.error("Error getting or focusing main window:", e);
        }
      }
    };

    focusRelevantWindow();
  }, [isCrashModalOpen, crashData]);

  useEffect(() => {
    let unlistenFn: UnlistenFn | undefined;
    let contentReceived = false;

    const listenForCrashContent = async () => {
      // Only run once per modal opening - check if we already fetched for this crash
      if (!isCrashModalOpen || !crashData?.process_id || !crashData?.profile_id || hasFetchedCrashReportRef.current) {
        return;
      }
      
      // Mark as fetched to prevent re-runs
      hasFetchedCrashReportRef.current = true;
      setIsListeningForCrashContent(true);
      
      console.log(`Setting up crash report handling for profile ${crashData.profile_id}, process ${crashData.process_id}`);
      
      // SCHRITT 1: Event-Listener SOFORT registrieren (um schnelle Events zu fangen)
      try {
        unlistenFn = await listen<EventPayload>(EventType.CrashReportContentAvailable, (event) => {
          if (event.payload.target_id === crashData.process_id && !contentReceived) {
            try {
              const contentPayload = JSON.parse(event.payload.message) as CrashReportContentAvailablePayload;
              if (contentPayload.content) {
                console.log(`Received CrashReportContentAvailable event for process ${crashData.process_id}`);
                contentReceived = true;
                setDisplayedCrashReportContent(contentPayload.content);
                toast.success(t('crash_modal.toast.report_loaded'));
                setIsListeningForCrashContent(false);
                if (unlistenFn) unlistenFn();
              }
            } catch (e) {
              console.error("Failed to parse CrashReportContentAvailablePayload:", e);
            }
          }
        });
        console.log(`Event listener registered for process ${crashData.process_id}`);
      } catch (error) {
        console.error("Failed to set up listener for CrashReportContentAvailable:", error);
      }
      
      // SCHRITT 2: Warte 1 Sekunde (gibt der Datei Zeit sich zu erstellen)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // SCHRITT 3: Falls Event noch nicht empfangen, aktiv fetchen als Fallback
      if (!contentReceived) {
        console.log(`Actively fetching crash report as fallback for process ${crashData.process_id}`);
        try {
          const fetchedContent = await fetchCrashReport(crashData.profile_id, crashData.process_id, crashData.process_metadata?.start_time);
          if (fetchedContent && !contentReceived) {
            console.log(`Successfully fetched crash report via fallback`);
            contentReceived = true;
            setDisplayedCrashReportContent(fetchedContent);
            toast.success(t('crash_modal.toast.report_loaded'));
            setIsListeningForCrashContent(false);
          } else if (!fetchedContent) {
            console.log(`No crash report found yet, listener remains active`);
          }
        } catch (e) {
          console.error("Failed to fetch crash report as fallback:", e);
        }
      }
    };

    listenForCrashContent();

    return () => {
      if (unlistenFn) {
        console.log("Cleaning up CrashReportContentAvailable listener.");
        unlistenFn();
      }
    };
  }, [isCrashModalOpen, crashData?.process_id, crashData?.profile_id]);

  if (!isCrashModalOpen || !crashData) {
    return null;
  }

  const handlePrimaryAction = async () => {
    if (!crashData?.profile_id || !crashData?.process_metadata) {
      toast.error(t('crash_modal.toast.missing_data'));
      console.error("Action error: Missing profile_id or process_metadata", crashData);
      return;
    }

    setIsProcessing(true);
    let currentMclogsUrl = mclogsUrl;
    const mainToastId = toast.loading(t('crash_modal.toast.processing'));

    try {
      // NEUE LOGIK: Vor dem Upload nochmal den neuesten Crash-Report holen
      if (crashData.process_id && !displayedCrashReportContent) {
        toast.loading(t('crash_modal.toast.fetching_before_upload'), { id: mainToastId });
        try {
          const fetchedContent = await fetchCrashReport(crashData.profile_id, crashData.process_id, crashData.process_metadata?.start_time);
          if (fetchedContent) {
            console.log('Fetched fresh crash report before upload');
            setDisplayedCrashReportContent(fetchedContent);
          }
        } catch (e) {
          console.warn('Failed to fetch crash report before upload, continuing with existing data:', e);
        }
      }

      if (!currentMclogsUrl) {
        toast.loading(t('crash_modal.toast.fetching_log'), { id: mainToastId });
        const logContent = await getProfileLatestLogContent(crashData.profile_id);
        
        let combinedLogContent = logContent;
        if (displayedCrashReportContent && displayedCrashReportContent.trim() !== "") {
          combinedLogContent = `--- CRASH REPORT ---\n${displayedCrashReportContent}\n\n--- LATEST LOG ---\n${logContent}`;
          toast.loading(t('crash_modal.toast.preparing_combined'), { id: mainToastId });
        }

        if (!combinedLogContent || combinedLogContent.trim() === "") {
          throw new Error(t('crash_modal.error.no_log_content'));
        }
        
        toast.loading(t('crash_modal.toast.uploading_mclogs'), { id: mainToastId });
        currentMclogsUrl = await uploadLogToMclogs(combinedLogContent);
        setMclogsUrl(currentMclogsUrl);
      }

      if (currentMclogsUrl && !noriskReportSubmitted) {
        toast.loading(t('crash_modal.toast.submitting_norisk'), { id: mainToastId });
        const crashReportPayload: CrashlogDto = {
          mcLogsUrl: currentMclogsUrl,
          metadata: crashData.process_metadata!, 
        };
        
        await submitCrashLog(crashReportPayload);
        setNoriskReportSubmitted(true);
        
        try {
          await writeText(currentMclogsUrl);
          toast.success(t('crash_modal.toast.submitted_and_copied'), { id: mainToastId });
        } catch (copyError) {
          console.error("Failed to copy mclogs URL after report:", copyError);
          toast.success(t('crash_modal.toast.submitted_copy_failed', { url: currentMclogsUrl }), { id: mainToastId });
        }
        
        // Open browser with mclogs URL
        try {
          await openExternalUrl(currentMclogsUrl);
          console.log("Opened mclogs URL in browser:", currentMclogsUrl);
        } catch (browserError) {
          console.error("Failed to open mclogs URL in browser:", browserError);
        }
      } else if (currentMclogsUrl && noriskReportSubmitted) {
        toast.dismiss(mainToastId);
        await writeText(currentMclogsUrl);
        toast.success(t('crash_modal.toast.url_copied'));
        
        // Open browser with mclogs URL
        try {
          await openExternalUrl(currentMclogsUrl);
          console.log("Opened mclogs URL in browser:", currentMclogsUrl);
        } catch (browserError) {
          console.error("Failed to open mclogs URL in browser:", browserError);
        }
      } else {
        toast.dismiss(mainToastId);
      }
    } catch (error: any) {
      toast.error(error.message || t('crash_modal.toast.unexpected_error'), { id: mainToastId });
      console.error("Crash report processing error:", error);
    } finally {
      setIsProcessing(false);
    }
  };
  
  const handleContactSupport = async () => {
    try {
      await openExternalUrl('https://discord.norisk.gg');
      toast.success(t('crash_modal.toast.discord_opened'));
    } catch (error) {
      console.error("Failed to open Discord URL:", error);
      toast.error(t('crash_modal.toast.discord_failed'));
    }
  };

  let primaryButtonText = t('crash_modal.button.upload_logs');
  if (mclogsUrl && noriskReportSubmitted) {
    primaryButtonText = t('crash_modal.button.copy_log_url');
  }

  const modalFooter = (
    <div className="flex gap-3 w-full">
      <Button
        onClick={handlePrimaryAction}
        variant="secondary"
        icon={<Icon icon={mclogsUrl && noriskReportSubmitted ? "solar:copy-line-duotone" : "solar:upload-linear"} className="w-5 h-5" />}
        disabled={isProcessing || !crashData?.process_metadata}
        className="flex-1 justify-center whitespace-nowrap"
      >
        {primaryButtonText}
      </Button>
      <Button
        onClick={handleContactSupport}
        variant="default"
        icon={<Icon icon="solar:letter-linear" className="w-5 h-5" />}
        disabled={isProcessing}
        className="flex-1 justify-center whitespace-nowrap"
      >
        {t('crash_modal.button.contact_support')}
      </Button>
    </div>
  );

  const titleSubtitleNode = (
    <p className="text-xs font-minecraft-ten text-gray-400">
      {t('crash_modal.profile_label')}: {crashData.process_metadata?.profile_name || profileName || t('common.loading')}
    </p>
  );

  return (
    <Modal
      title={t('crash_modal.title')}
      titleIcon={<Icon icon="solar:danger-bold" className="w-7 h-7 text-red-400" />}
      titleSubtitle={titleSubtitleNode}
      onClose={() => !isProcessing && closeCrashModal()}
      width="lg"
      footer={modalFooter}
    >
      <div className="p-6 space-y-4 text-white text-base text-center">
        <p className="pt-3 text-gray-300 text-lg font-minecraft-ten">
          {t('crash_modal.description')}
        </p>

        <p className="pt-4 text-2xl font-minecraft text-red-400">
          {t('crash_modal.exit_code')}: {crashData.exit_code ?? 'N/A'}
        </p>
      </div>
    </Modal>
  );
} 