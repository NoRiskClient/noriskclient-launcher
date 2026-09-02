import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { StaticTooltip } from "../ui/Tooltip";
import { useCrashModalStore } from "../../store/crash-modal-store";
import { Button } from "../ui/buttons/Button";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { getProfile } from "../../services/profile-service";
import { uploadLogToMclogs } from "../../services/log-service";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  checkCrashLog,
  fetchCrashReport,
  getProcessLogCursor,
} from "../../services/process-service";
import type { CrashlogDto } from "../../types/processState";
import { openExternalUrl } from "../../services/tauri-service";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { CrashAnalysisModal } from "./CrashAnalysisModal";
import { logError } from "../../utils/logging-utils";
import { Window } from "@tauri-apps/api/window";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type {
  EventPayload,
  CrashReportContentAvailablePayload,
} from "../../types/events";
import { EventType } from "../../types/events";

export function GlobalCrashReportModal() {
  const { t } = useTranslation();
  const { isCrashModalOpen, crashData, closeCrashModal } = useCrashModalStore();
  const { showModal, hideModal } = useGlobalModal();
  const [profileName, setProfileName] = useState<string>("");
  const [mclogsUrl, setMclogsUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null); // inline progress while analyzing
  const [displayedCrashReportContent, setDisplayedCrashReportContent] =
    useState<string | undefined>(undefined);
  const [isListeningForCrashContent, setIsListeningForCrashContent] =
    useState(false);
  const hasFetchedCrashReportRef = React.useRef(false);

  useEffect(() => {
    if (crashData?.profile_id) {
      if (crashData.process_metadata?.profile_name) {
        setProfileName(crashData.process_metadata.profile_name);
      } else {
        setProfileName(crashData.profile_id);
        getProfile(crashData.profile_id)
          .then((details) => {
            if (details?.name) {
              setProfileName(details.name);
            }
          })
          .catch((err) => {
            console.error(
              `Failed to fetch profile details for ${crashData.profile_id}:`,
              err,
            );
          });
      }
      setMclogsUrl(null);
      setIsProcessing(false);
      setDisplayedCrashReportContent(crashData.crash_report_content);
      setIsListeningForCrashContent(false);
      hasFetchedCrashReportRef.current = false; // Reset fetch flag for new crash
    } else {
      setProfileName("");
      setMclogsUrl(null);
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
        console.log(
          `Crash modal open for process ${crashedProcessId}. Opening/focusing log window.`,
        );

        // Try to find existing single log window for this process
        const singleLogWindowLabel = `single_log_window_${crashedProcessId}`;
        let foundLogWindow = false;

        try {
          const singleLogWindow = await Window.getByLabel(singleLogWindowLabel);
          if (singleLogWindow) {
            console.log(
              `Focusing existing single log window: ${singleLogWindowLabel}`,
            );
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
                  state: { Crashed: { exit_code: crashData.exit_code } },
                }),
              });
            } else {
              await invoke("open_minecraft_log_window", {
                crashedProcess: null,
              });
            }
          } catch (e) {
            console.error("Failed to open log window for crash:", e);
          }
        }

        // Also focus main window
        try {
          const mainWindowInstance = await Window.getByLabel("main");
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
      if (
        !isCrashModalOpen ||
        !crashData?.process_id ||
        !crashData?.profile_id ||
        hasFetchedCrashReportRef.current
      ) {
        return;
      }

      // Mark as fetched to prevent re-runs
      hasFetchedCrashReportRef.current = true;
      setIsListeningForCrashContent(true);

      console.log(
        `Setting up crash report handling for profile ${crashData.profile_id}, process ${crashData.process_id}`,
      );

      // SCHRITT 1: Event-Listener SOFORT registrieren (um schnelle Events zu fangen)
      try {
        unlistenFn = await listen<EventPayload>(
          EventType.CrashReportContentAvailable,
          (event) => {
            if (
              event.payload.target_id === crashData.process_id &&
              !contentReceived
            ) {
              try {
                const contentPayload = JSON.parse(
                  event.payload.message,
                ) as CrashReportContentAvailablePayload;
                if (contentPayload.content) {
                  console.log(
                    `Received CrashReportContentAvailable event for process ${crashData.process_id}`,
                  );
                  contentReceived = true;
                  setDisplayedCrashReportContent(contentPayload.content);
                  toast.success(t("crash_modal.toast.report_loaded"));
                  setIsListeningForCrashContent(false);
                  if (unlistenFn) unlistenFn();
                }
              } catch (e) {
                console.error(
                  "Failed to parse CrashReportContentAvailablePayload:",
                  e,
                );
              }
            }
          },
        );
        console.log(
          `Event listener registered for process ${crashData.process_id}`,
        );
      } catch (error) {
        console.error(
          "Failed to set up listener for CrashReportContentAvailable:",
          error,
        );
      }

      // SCHRITT 2: Warte 1 Sekunde (gibt der Datei Zeit sich zu erstellen)
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // SCHRITT 3: Falls Event noch nicht empfangen, aktiv fetchen als Fallback
      if (!contentReceived) {
        console.log(
          `Actively fetching crash report as fallback for process ${crashData.process_id}`,
        );
        try {
          const fetchedContent = await fetchCrashReport(
            crashData.profile_id,
            crashData.process_id,
            crashData.process_metadata?.start_time,
          );
          if (fetchedContent && !contentReceived) {
            console.log(`Successfully fetched crash report via fallback`);
            contentReceived = true;
            setDisplayedCrashReportContent(fetchedContent);
            toast.success(t("crash_modal.toast.report_loaded"));
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
      toast.error(t("crash_modal.toast.missing_data"));
      console.error(
        "Action error: Missing profile_id or process_metadata",
        crashData,
      );
      return;
    }

    setIsProcessing(true);
    setStatusText(t("crash_modal.toast.processing"));
    let currentMclogsUrl = mclogsUrl;

    try {
      // NEUE LOGIK: Vor dem Upload nochmal den neuesten Crash-Report holen
      if (crashData.process_id && !displayedCrashReportContent) {
        setStatusText(t("crash_modal.toast.fetching_before_upload"));
        try {
          const fetchedContent = await fetchCrashReport(
            crashData.profile_id,
            crashData.process_id,
            crashData.process_metadata?.start_time,
          );
          if (fetchedContent) {
            console.log("Fetched fresh crash report before upload");
            setDisplayedCrashReportContent(fetchedContent);
          }
        } catch (e) {
          console.warn(
            "Failed to fetch crash report before upload, continuing with existing data:",
            e,
          );
        }
      }

      if (!currentMclogsUrl) {
        setStatusText(t("crash_modal.toast.fetching_log"));
        const sessionId = crashData.process_metadata?.log_session_id;
        const logContent = sessionId
          ? (await getProcessLogCursor(sessionId, 0)).output
          : "";

        let combinedLogContent = logContent;
        if (
          displayedCrashReportContent &&
          displayedCrashReportContent.trim() !== ""
        ) {
          combinedLogContent = `--- CRASH REPORT ---\n${displayedCrashReportContent}\n\n--- GAME LOG ---\n${logContent}`;
          setStatusText(t("crash_modal.toast.preparing_combined"));
        }

        if (!combinedLogContent || combinedLogContent.trim() === "") {
          throw new Error(t("crash_modal.error.no_log_content"));
        }

        setStatusText(t("crash_modal.toast.uploading_mclogs"));
        currentMclogsUrl = await uploadLogToMclogs(combinedLogContent);
        setMclogsUrl(currentMclogsUrl);
      }

      if (currentMclogsUrl) {
        const crashReportPayload: CrashlogDto = {
          mcLogsUrl: currentMclogsUrl,
          metadata: crashData.process_metadata!,
        };

        // single call: the discord-bot reports the crash to staff AND returns the verdict
        setStatusText(t("crash_modal.toast.analyzing"));
        try {
          const result = await checkCrashLog(crashReportPayload);
          closeCrashModal();
          showModal(
            "crash-analysis",
            <CrashAnalysisModal
              result={result}
              profileId={crashData?.profile_id}
              onClose={() => hideModal("crash-analysis")}
            />,
          );
        } catch (analyzeError) {
          // backend offline / analysis failed → graceful fallback: copy + open the raw log
          logError(
            `Crash analysis failed, falling back to log link: ${analyzeError}`,
          );
          try {
            await writeText(currentMclogsUrl);
          } catch {}
          toast.error(t("crash_modal.toast.analyze_failed"));
          try {
            await openExternalUrl(currentMclogsUrl);
          } catch {}
        }
      }
    } catch (error: any) {
      toast.error(error.message || t("crash_modal.toast.unexpected_error"));
      console.error("Crash report processing error:", error);
    } finally {
      setIsProcessing(false);
      setStatusText(null);
    }
  };

  const handleContactSupport = async () => {
    try {
      await openExternalUrl("https://discord.norisk.gg");
      toast.success(t("crash_modal.toast.discord_opened"));
    } catch (error) {
      console.error("Failed to open Discord URL:", error);
      toast.error(t("crash_modal.toast.discord_failed"));
    }
  };

  const primaryButtonText = t("crash_modal.button.analyze");

  const modalFooter = (
    <div className="flex gap-3 w-full">
      <div className="relative flex-1">
        <Button
          onClick={handlePrimaryAction}
          variant="secondary"
          icon={<Icon icon="solar:shield-check-bold" className="w-5 h-5" />}
          disabled={isProcessing || !crashData?.process_metadata}
          className="w-full justify-center whitespace-nowrap"
        >
          {primaryButtonText}
        </Button>
        {/* BETA badge — corner overlay like the rollout blitz in MainLaunchButton; tooltip on hover */}
        <div className="absolute -top-2 -left-2 z-10 pointer-events-auto">
          <StaticTooltip content={t("crash_modal.tooltip.beta")} delay={0}>
            <span className="rounded border border-amber-400/50 bg-amber-400/30 px-1.5 py-0.5 text-[10px] font-minecraft uppercase leading-none text-amber-200 cursor-help shadow-md">
              beta
            </span>
          </StaticTooltip>
        </div>
      </div>
      <Button
        onClick={handleContactSupport}
        variant="default"
        icon={<Icon icon="solar:letter-linear" className="w-5 h-5" />}
        disabled={isProcessing}
        className="flex-1 justify-center whitespace-nowrap"
      >
        {t("crash_modal.button.contact_support")}
      </Button>
    </div>
  );

  const titleSubtitleNode = (
    <p className="text-xs font-minecraft text-gray-400">
      {t("crash_modal.profile_label")}:{" "}
      {crashData.process_metadata?.profile_name ||
        profileName ||
        t("common.loading")}
    </p>
  );

  return (
    <Modal
      title={t("crash_modal.title")}
      titleIcon={
        <Icon icon="solar:danger-bold" className="w-7 h-7 text-red-400" />
      }
      titleSubtitle={titleSubtitleNode}
      onClose={() => !isProcessing && closeCrashModal()}
      width="lg"
      footer={modalFooter}
    >
      <div className="p-6 space-y-4 text-white text-base text-center">
        {isProcessing ? (
          <div className="flex flex-col items-center justify-center gap-4 py-10">
            <Icon
              icon="solar:shield-check-bold"
              className="w-12 h-12 text-amber-300 animate-pulse"
            />
            <p className="text-lg font-minecraft text-gray-200">
              {statusText ?? t("common.loading")}
            </p>
          </div>
        ) : (
          <>
            <p className="pt-3 text-gray-300 text-lg font-minecraft">
              {t("crash_modal.description")}
            </p>

            <p className="pt-4 text-base font-smallcaps text-red-400">
              {t("crash_modal.exit_code")}: {crashData.exit_code ?? "N/A"}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
