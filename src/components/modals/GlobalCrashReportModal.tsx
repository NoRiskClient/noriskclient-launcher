import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n/i18n';
import { Modal } from '../ui/Modal';
import { StaticTooltip } from '../ui/Tooltip';
import { useCrashModalStore } from '../../store/crash-modal-store';
import { Button } from '../ui/buttons/Button';
import { Checkbox } from '../ui/Checkbox';
import { Icon } from '@iconify/react';
import { toast } from 'react-hot-toast';
import { getProfile } from '../../services/profile-service';
import { uploadLogToMclogs } from '../../services/log-service';
import { shareCrashLogLink, crashLogShareMessageKey } from '../../services/crash-log-share';
import { checkCrashLog, fetchCrashReport, getProcessLogCursor } from '../../services/process-service';
import type { CrashlogDto, ProcessMetadata } from '../../types/processState';
import type { CrashCheckResult } from '../../types/crash-analysis';
import { openExternalUrl } from '../../services/tauri-service';
import { useGlobalModal } from '../../hooks/useGlobalModal';
import { useAnimationsEnabled } from '../../hooks/useEntranceAnimation';
import { CrashAnalysisModal } from './CrashAnalysisModal';
import { logError, logWarn } from '../../utils/logging-utils';
import { Window } from '@tauri-apps/api/window';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { EventPayload, CrashReportContentAvailablePayload } from '../../types/events';
import { EventType } from '../../types/events';
import { parseErrorMessage } from '../../utils/error-utils';

export function GlobalCrashReportModal() {
  const { t } = useTranslation();
  const animationsEnabled = useAnimationsEnabled();
  const { isCrashModalOpen, crashData, closeCrashModal } = useCrashModalStore();
  const { showModal, hideModal } = useGlobalModal();
  const [profileName, setProfileName] = useState<string>('');
  const [mclogsUrl, setMclogsUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [analyzeWithNoRisk, setAnalyzeWithNoRisk] = useState(true);
  const [statusText, setStatusText] = useState<string | null>(null); // inline progress while analyzing
  const [displayedCrashReportContent, setDisplayedCrashReportContent] = useState<string | undefined>(undefined);
  const [isListeningForCrashContent, setIsListeningForCrashContent] = useState(false);
  const [shareFallbackUrl, setShareFallbackUrl] = useState<string | null>(null);
  const processingRef = useRef<symbol | null>(null);
  const normalBodyRef = useRef<HTMLDivElement>(null);
  const normalBodyHidden = isProcessing || shareFallbackUrl !== null;
  const hasFetchedCrashReportRef = React.useRef(false);

  useLayoutEffect(() => {
    if (normalBodyRef.current) normalBodyRef.current.inert = normalBodyHidden;
  }, [normalBodyHidden, isCrashModalOpen]);

  useLayoutEffect(() => {
    // A replacement crash must not inherit an earlier upload's busy guard or late UI updates.
    processingRef.current = null;
    setIsProcessing(false);
    setStatusText(null);
    return () => { processingRef.current = null; };
  }, [crashData, isCrashModalOpen]);

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
            logError(`Failed to fetch profile details for ${crashData.profile_id}: ${err}`);
          });
      }
      setMclogsUrl(null);
      setShareFallbackUrl(null);
      setIsProcessing(false);
      setAnalyzeWithNoRisk(true);
      setDisplayedCrashReportContent(crashData.crash_report_content);
      setIsListeningForCrashContent(false);
      hasFetchedCrashReportRef.current = false; // Reset fetch flag for new crash
    } else {
      setProfileName('');
      setMclogsUrl(null);
      setShareFallbackUrl(null);
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

        // Try to find existing single log window for this process
        const singleLogWindowLabel = `single_log_window_${crashedProcessId}`;
        let foundLogWindow = false;

        try {
          const singleLogWindow = await Window.getByLabel(singleLogWindowLabel);
          if (singleLogWindow) {
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
            logError(`Failed to open log window for crash: ${e}`);
          }
        }

        // Also focus main window
        try {
          const mainWindowInstance = await Window.getByLabel('main');
          if (mainWindowInstance) {
            await mainWindowInstance.show();
            await mainWindowInstance.unminimize();
            await mainWindowInstance.setFocus();
          }
        } catch (e) {
          logError(`Error getting or focusing main window: ${e}`);
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
      
      
      // SCHRITT 1: Event-Listener SOFORT registrieren (um schnelle Events zu fangen)
      try {
        unlistenFn = await listen<EventPayload>(EventType.CrashReportContentAvailable, (event) => {
          if (event.payload.target_id === crashData.process_id && !contentReceived) {
            try {
              const contentPayload = JSON.parse(event.payload.message) as CrashReportContentAvailablePayload;
              if (contentPayload.content) {
                contentReceived = true;
                setDisplayedCrashReportContent(contentPayload.content);
                toast.success(t('crash_modal.toast.report_loaded'));
                setIsListeningForCrashContent(false);
                if (unlistenFn) unlistenFn();
              }
            } catch (e) {
              logError(`Failed to parse CrashReportContentAvailablePayload: ${e}`);
            }
          }
        });
      } catch (error) {
        logError(`Failed to set up listener for CrashReportContentAvailable: ${error}`);
      }
      
      // SCHRITT 2: Warte 1 Sekunde (gibt der Datei Zeit sich zu erstellen)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // SCHRITT 3: Falls Event noch nicht empfangen, aktiv fetchen als Fallback
      if (!contentReceived) {
        try {
          const fetchedContent = await fetchCrashReport(crashData.profile_id, crashData.process_id, crashData.process_metadata?.start_time);
          if (fetchedContent && !contentReceived) {
            contentReceived = true;
            setDisplayedCrashReportContent(fetchedContent);
            toast.success(t('crash_modal.toast.report_loaded'));
            setIsListeningForCrashContent(false);
          }
        } catch (e) {
          logError(`Failed to fetch crash report as fallback: ${e}`);
        }
      }
    };

    listenForCrashContent();

    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [isCrashModalOpen, crashData?.process_id, crashData?.profile_id]);

  if (!isCrashModalOpen || !crashData) {
    return null;
  }

  const assertActiveOperation = (operation: symbol) => {
    if (processingRef.current !== operation) throw new Error('Crash report processing was superseded');
  };

  const shareLogLink = async (url: string, analysisFailed: boolean, operation: symbol) => {
    assertActiveOperation(operation);
    const result = await shareCrashLogLink(url, () => processingRef.current === operation);
    assertActiveOperation(operation);
    const message = t(crashLogShareMessageKey(result, analysisFailed));
    if (analysisFailed || !result.copied || !result.opened) toast.error(message);
    else toast.success(message);
    if (!result.copied && !result.opened) setShareFallbackUrl(url);
    return result;
  };

  const buildLogContent = async (profileId: string, metadata: ProcessMetadata, operation: symbol): Promise<string> => {
    assertActiveOperation(operation);
    let crashReport = displayedCrashReportContent;
    if (crashData?.process_id && !crashReport) {
      setStatusText(t('crash_modal.toast.fetching_before_upload'));
      try {
        crashReport = (await fetchCrashReport(profileId, crashData.process_id, metadata.start_time)) ?? undefined;
        assertActiveOperation(operation);
        if (crashReport) setDisplayedCrashReportContent(crashReport);
      } catch (e) {
        assertActiveOperation(operation);
        logWarn(`Failed to fetch crash report before upload, continuing with existing data: ${e}`);
      }
    }

    setStatusText(t('crash_modal.toast.fetching_log'));
    const gameLog = metadata.log_session_id
      ? (await getProcessLogCursor(metadata.log_session_id, 0)).output
      : "";
    assertActiveOperation(operation);

    const content = crashReport?.trim()
      ? `--- CRASH REPORT ---
${crashReport}

--- GAME LOG ---
${gameLog}`
      : gameLog;

    if (!content.trim()) {
      throw new Error(t('crash_modal.error.no_log_content'));
    }
    return content;
  };

  const ensureUploaded = async (profileId: string, metadata: ProcessMetadata, operation: symbol): Promise<string> => {
    assertActiveOperation(operation);
    if (mclogsUrl) return mclogsUrl;
    const content = await buildLogContent(profileId, metadata, operation);
    assertActiveOperation(operation);
    setStatusText(t('crash_modal.toast.uploading_mclogs'));
    const url = await uploadLogToMclogs(content);
    assertActiveOperation(operation);
    setMclogsUrl(url);
    return url;
  };

  const analyze = async (url: string, profileId: string, metadata: ProcessMetadata, operation: symbol) => {
    assertActiveOperation(operation);
    setStatusText(t('crash_modal.toast.analyzing'));
    const payload: CrashlogDto = { mcLogsUrl: url, metadata, locale: i18n.language };
    let result: CrashCheckResult;
    try {
      result = await checkCrashLog(payload);
    } catch (e) {
      assertActiveOperation(operation);
      logError(`Crash analysis failed, falling back to log link: ${e}`);
      await shareLogLink(url, true, operation);
      return;
    }
    assertActiveOperation(operation);
    closeCrashModal();
    showModal(
      'crash-analysis',
      <CrashAnalysisModal
        result={result}
        profileId={profileId}
        onClose={() => hideModal('crash-analysis')}
      />,
    );
  };

  const handlePrimaryAction = async () => {
    if (processingRef.current) return;
    const profileId = crashData?.profile_id;
    const metadata = crashData?.process_metadata;
    if (!profileId || !metadata) {
      toast.error(t('crash_modal.toast.missing_data'));
      logError(`Action error: Missing profile_id or process_metadata for process ${crashData?.process_id}`);
      return;
    }

    const operation = Symbol('crash-report-processing');
    processingRef.current = operation;
    setShareFallbackUrl(null);
    setIsProcessing(true);
    setStatusText(t('crash_modal.toast.processing'));
    try {
      const url = await ensureUploaded(profileId, metadata, operation);
      assertActiveOperation(operation);
      if (analyzeWithNoRisk) {
        await analyze(url, profileId, metadata, operation);
      } else {
        const shared = await shareLogLink(url, false, operation);
        if (shared.copied || shared.opened) closeCrashModal();
      }
    } catch (error) {
      if (processingRef.current !== operation) return;
      toast.error(parseErrorMessage(error) || t('crash_modal.toast.unexpected_error'));
      logError(`Crash report processing error: ${error}`);
    } finally {
      if (processingRef.current === operation) {
        processingRef.current = null;
        setIsProcessing(false);
        setStatusText(null);
      }
    }
  };

  const handleContactSupport = async () => {
    try {
      await openExternalUrl('https://discord.norisk.gg');
      toast.success(t('crash_modal.toast.discord_opened'));
    } catch (error) {
      logError(`Failed to open Discord URL: ${error}`);
      toast.error(t('crash_modal.toast.discord_failed'));
    }
  };

  const primaryButtonText = analyzeWithNoRisk ? t('crash_modal.button.analyze') : t('crash_modal.button.upload_only');

  const modalFooter = (
    <div className="flex gap-3 w-full">
      <div className="relative flex-1">
        <Button
          onClick={handlePrimaryAction}
          variant="secondary"
          icon={<Icon icon={analyzeWithNoRisk ? "solar:shield-check-bold" : "solar:cloud-upload-bold"} className="w-5 h-5" />}
          disabled={isProcessing || !crashData?.process_metadata}
          className="w-full justify-center whitespace-nowrap"
        >
          {primaryButtonText}
        </Button>
        {/* BETA badge — corner overlay like the rollout blitz in MainLaunchButton; tooltip on hover */}
        {analyzeWithNoRisk && (
        <div className="absolute -top-2 -left-2 z-10 pointer-events-auto">
          <StaticTooltip content={t('crash_modal.tooltip.beta')} delay={0}>
            <span className="rounded border border-amber-400/50 bg-amber-400/30 px-1.5 py-0.5 text-[10px] font-minecraft uppercase leading-none text-amber-200 cursor-help shadow-md">
              beta
            </span>
          </StaticTooltip>
        </div>
        )}
      </div>
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
    <p className="text-xs font-minecraft text-gray-400">
      {t('crash_modal.profile_label')}: {crashData.process_metadata?.profile_name || profileName || t('common.loading')}
    </p>
  );

  return (
    <Modal
      title={t('crash_modal.title')}
      titleIcon={<Icon icon="solar:danger-bold" className="w-7 h-7 text-red-400" />}
      titleSubtitle={titleSubtitleNode}
      onClose={() => { if (!processingRef.current) closeCrashModal(); }}
      canClose={() => !processingRef.current}
      closeOnClickOutside={!isProcessing}
      closeOnEscape={!isProcessing}
      hideCloseButton={isProcessing}
      reserveCloseButtonSpace
      width="lg"
      footer={modalFooter}
    >
      <div className="relative p-6 text-white text-base text-center" aria-busy={isProcessing}>
        {/* Keep the actual normal content in flow so asynchronous completion cannot re-center the panel. */}
        <div
          ref={normalBodyRef}
          aria-hidden={normalBodyHidden}
          className={`space-y-4 ${normalBodyHidden ? 'invisible opacity-0 pointer-events-none' : ''}`}
        >
          <p className="pt-3 text-gray-300 text-lg font-minecraft">
            {t('crash_modal.description')}
          </p>

          <p className="pt-4 text-base font-smallcaps text-red-400">
            {t('crash_modal.exit_code')}: {crashData.exit_code ?? 'N/A'}
          </p>

          <div className="pt-4 space-y-3 text-left">
            <p className="text-sm font-minecraft text-gray-400">
              {t('crash_modal.upload_notice')}
            </p>
            <Checkbox
              checked={analyzeWithNoRisk}
              onChange={(e) => setAnalyzeWithNoRisk(e.target.checked)}
              disabled={normalBodyHidden}
              label={t('crash_modal.report_checkbox')}
              size="sm"
            />
          </div>
        </div>
        {isProcessing && (
          <div className="absolute inset-6 flex flex-col items-center justify-center gap-4 overflow-y-auto" role="status" aria-live="polite">
            <Icon icon="solar:shield-check-bold" className={`w-12 h-12 text-amber-300 ${animationsEnabled ? 'animate-pulse' : ''}`} />
            <p className="text-lg font-minecraft text-gray-200">
              {statusText ?? t('common.loading')}
            </p>
          </div>
        )}
        {!isProcessing && shareFallbackUrl && (
          <div className="absolute inset-6 space-y-3 overflow-y-auto text-left">
            <p className="text-sm text-red-200 font-minecraft" role="alert">
              {t('crash_modal.toast.link_share_failed')}
            </p>
            <label className="block text-sm font-minecraft text-gray-300">
              {t('crash_modal.log_link')}
              <input
                readOnly
                autoFocus
                value={shareFallbackUrl}
                aria-label={t('crash_modal.log_link')}
                onFocus={event => event.currentTarget.select()}
                className="mt-1 block w-full min-w-0 rounded-md border border-white/20 bg-black/30 px-3 py-2 text-sm text-white font-sans select-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              />
            </label>
            <Button variant="secondary" size="sm" onClick={() => setShareFallbackUrl(null)}>
              {t('common.back')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
