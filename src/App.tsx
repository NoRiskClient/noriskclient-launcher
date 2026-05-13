"use client";

import { useEffect, useState } from "react";
import {
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
} from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { ThemeInitializer } from "./components/ThemeInitializer";
import { ScrollbarProvider } from "./components/ui/ScrollbarProvider";
import { GlobalToaster } from "./components/ui/GlobalToaster";
import { type Event as TauriEvent, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "react-hot-toast";
import {
  type EventPayload as FrontendEventPayload,
  EventType as FrontendEventType,
  type MinecraftProcessExitedPayload,
} from "./types/events";
import { GlobalCrashReportModal } from "./components/modals/GlobalCrashReportModal";
import { TermsOfServiceModal, AnalyticsConsentBanner } from "./components/modals/TermsOfServiceModal";
import { GlobalModalPortal } from "./components/ui/GlobalModalPortal";
import { useCrashModalStore } from "./store/crash-modal-store";
import { useThemeStore } from "./store/useThemeStore";
import { useGlobalModal } from "./hooks/useGlobalModal";
import { Modal } from "./components/ui/Modal";
import { refreshNrcDataOnMount } from "./services/nrc-service";
import {
  getLauncherConfig,
  setProfileGroupingPreference,
} from "./services/launcher-config-service";
import * as ConfigService from "./services/launcher-config-service";
import { useGlobalDragAndDrop } from './hooks/useGlobalDragAndDrop';
import { loadIcons } from '@iconify/react';
import { trackEvent } from "./services/analytics-service";

let launcherStartTracked = false;

import flagsmith from 'flagsmith';
import { FlagsmithProvider } from 'flagsmith/react';
import { Button } from "./components/ui/buttons/Button";
import { openExternalUrl } from "./services/tauri-service";
import { ExternalLink } from "lucide-react";
import { MinecraftAuthService } from "./services/minecraft-auth-service";
import ChildProtectionModal from "./components/modals/ChildProtectionModal";
import { NotificationModal } from "./components/modals/NotificationModal";
import { useNotificationStore } from "./store/notification-store";
import { useMinecraftAuthStore } from "./store/minecraft-auth-store";
import { hasPermission, refreshPermissions } from "./services/permission-service";
import {
  fetchTesterQueueCount,
  openTesterWindow,
} from "./services/tester-service";
import { useTranslation } from "react-i18next";

export type ProfilesTabContext = {
  currentGroupingCriterion: string;
  onGroupingChange: (newCriterion: string) => void;
};

export function App() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { openCrashModal } = useCrashModalStore();
  const {
    hasAcceptedTermsOfService,
    analyticsConsent,
    setAnalyticsConsent,
    shouldShowAnalyticsBanner,
    incrementLaunchCount,
  } = useThemeStore();
  const { showModal, hideModal } = useGlobalModal();
  const { activeAccount } = useMinecraftAuthStore();
  const { fetchNotifications } = useNotificationStore();

  const activeTab = location.pathname.substring(1) || "play";


  const [currentGroupingCriterion, setCurrentGroupingCriterion] =
      useState<string>("none");

  useEffect(() => {
    const root = document.documentElement;
    const storedTheme = localStorage.getItem("norisk-theme-storage");
    if (storedTheme) {
      try {
        const themeData = JSON.parse(storedTheme);
        if (themeData.state?.accentColor?.value) {
          root.style.setProperty("--accent", themeData.state.accentColor.value);
          root.style.setProperty(
              "--accent-hover",
              themeData.state.accentColor.hoverValue,
          );

          const hexToRgb = (hex: string) => {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(
                hex,
            );
            return result
                ? `${Number.parseInt(result[1], 16)}, ${Number.parseInt(result[2], 16)}, ${Number.parseInt(result[3], 16)}`
                : null;
          };

          const rgbValue = hexToRgb(themeData.state.accentColor.value);
          if (rgbValue) {
            root.style.setProperty("--accent-rgb", rgbValue);
          }
        }

        if (themeData.state?.radiusTheme) {
          const radiusTheme = themeData.state.radiusTheme;
          root.setAttribute("data-radius-theme", radiusTheme);

          if (radiusTheme === "flat") {
            root.classList.add("radius-flat");
            root.style.setProperty("--radius", "0px");
          } else {
            root.classList.remove("radius-flat");
            const radiusMap: Record<string, string> = {
              sm: "var(--radius-sm)",
              md: "var(--radius-md)",
              lg: "var(--radius-lg)",
              xl: "var(--radius-xl)",
              "2xl": "var(--radius-2xl)",
            };
            root.style.setProperty("--radius", radiusMap[radiusTheme] || "var(--radius-md)");
          }
        }
      } catch (e) {
        console.error("Failed to parse stored theme:", e);
      }
    }
  }, []);

  useEffect(() => {
    const unlisten = listen<FrontendEventPayload>(
        "state_event",
        (event: TauriEvent<FrontendEventPayload>) => {
          if (
              event.payload.event_type === FrontendEventType.MinecraftProcessExited
          ) {
            try {
              const exitPayload: MinecraftProcessExitedPayload = JSON.parse(
                  event.payload.message,
              );
              console.log(
                  "[App.tsx] Global MinecraftProcessExited event:",
                  exitPayload,
              );
              if (!exitPayload.success) {
                const crashMsg = `Minecraft crashed (Exit Code: ${exitPayload.exit_code ?? "N/A"}). See crash report for details.`;
                toast.error(crashMsg, { duration: 10000 });
                openCrashModal(exitPayload);
              }
            } catch (e) {
              console.error(
                  "[App.tsx] Failed to parse MinecraftProcessExitedPayload:",
                  e,
              );
              toast.error(t('app.errors.process_status'));
            }
          }
        },
    );

    return () => {
      unlisten.then((f) => f());
    };
  }, [openCrashModal]);

  // Listen for navigation events from other windows (e.g., log window)
  useEffect(() => {
    const unlisten = listen<{ profileId: string }>(
      "navigate-to-profile",
      (event) => {
        const { profileId } = event.payload;
        console.log("[App.tsx] Navigate to profile:", profileId);
        navigate(`/profilesv2/${profileId}`);
      },
    );

    return () => {
      unlisten.then((f) => f());
    };
  }, [navigate]);

  // Listen for deep link auth bridge requests
  useEffect(() => {
    const unlisten = listen<{ session_id: string; username: string }>(
      "deep-link-auth-request",
      (event) => {
        const { session_id, username } = event.payload;
        console.log("[App.tsx] Deep link auth request for:", username);

        showModal(
          "deep-link-auth",
          <Modal
            title={t("deep_link.auth.title")}
            onClose={() => hideModal("deep-link-auth")}
            width="sm"
            footer={
              <div className="flex justify-end gap-3">
                <Button
                  variant="ghost"
                  onClick={() => hideModal("deep-link-auth")}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="default"
                  onClick={async () => {
                    hideModal("deep-link-auth");
                    try {
                      const result = await invoke<{
                        success: boolean;
                        message: string;
                      }>("confirm_auth_bridge", {
                        sessionId: session_id,
                      });
                      if (result.success) {
                        toast.success(t("deep_link.auth.success"));
                      } else {
                        console.error("[App.tsx] Auth bridge confirm failed:", result.message);
                        toast.error(t("deep_link.auth.error"));
                      }
                    } catch (e) {
                      console.error("[App.tsx] Auth bridge confirm failed:", e);
                      toast.error(t("deep_link.auth.error"));
                    }
                  }}
                >
                  {t("deep_link.auth.confirm")}
                </Button>
              </div>
            }
          >
            <div className="p-6 text-white/80 font-minecraft-ten">
              <p>{t("deep_link.auth.description", { username })}</p>
            </div>
          </Modal>,
        );
      },
    );

    // Also listen for auth results when no confirmation is needed (e.g., errors)
    const unlistenResult = listen<{ success: boolean; message: string }>(
      "deep-link-auth-result",
      (event) => {
        const { success, message } = event.payload;
        if (!success) {
          if (message === "not_logged_in") {
            toast.error(t("deep_link.auth.not_logged_in"));
          } else {
            console.error("[App.tsx] Auth bridge confirm failed:", message);
            toast.error(t("deep_link.auth.error"));
          }
        }
      },
    );

    return () => {
      unlisten.then((f) => f());
      unlistenResult.then((f) => f());
    };
  }, [showModal, hideModal, t]);

  useEffect(() => {
    refreshNrcDataOnMount();
  }, []);

  useEffect(() => {
    if (analyticsConsent.decision !== 'accepted') return;

    let cancelled = false;
    const themePersist = useThemeStore.persist;

    const sendLauncherStarted = async () => {
      if (cancelled || launcherStartTracked || !themePersist.hasHydrated()) return;

      launcherStartTracked = true;
      try {
        const launcherVersion = await invoke<string>('get_app_version').catch(() => 'unknown');
        const javaInfo: any = await invoke('get_java_info_command').catch(() => null);
        const osInfo = await invoke<{ os: string; os_version: string; arch: string }>(
          'get_system_os_info',
        ).catch(() => ({ os: 'unknown', os_version: 'unknown', arch: 'unknown' }));
        const resolvedLanguage = useThemeStore.getState().language;
        await trackEvent('launcher_started', {
          launcher_version: launcherVersion,
          java_version: javaInfo?.version ?? 'unknown',
          os: osInfo.os,
          os_version: osInfo.os_version,
          arch: osInfo.arch,
          language: resolvedLanguage,
        });
      } catch (error) {
        launcherStartTracked = false;
        console.error('[App] launcher_started tracking failed:', error);
      }
    };

    void sendLauncherStarted();
    const unsub = themePersist.onFinishHydration(() => {
      void sendLauncherStarted();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [analyticsConsent.decision]);

  // Fetch notifications when user is logged in
  useEffect(() => {
    if (activeAccount) {
      fetchNotifications().catch((error) => {
        console.error("[App.tsx] Failed to fetch notifications:", error);
      });
    }
  }, [activeAccount, fetchNotifications]);

  useEffect(() => {
    if (!activeAccount) return;
    let cancelled = false;
    (async () => {
      try {
        await refreshPermissions();
        if (cancelled) return;
        const allowed = await hasPermission("norisk.tester");
        if (cancelled || !allowed) return;
        const { count } = await fetchTesterQueueCount();
        if (cancelled || count <= 0) return;
        await openTesterWindow();
      } catch (err) {
        console.warn("[App.tsx] tester queue check skipped:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAccount]);

  // Icons beim App-Start vorladen
  useEffect(() => {
    const preloadIcons = async () => {
      await loadIcons([
        // Action Buttons
        'solar:play-bold',
        'solar:box-bold',
        'solar:settings-bold',

        // Group Tabs & Navigation
        'solar:add-circle-bold',
        'solar:user-id-bold',
        'solar:widget-bold',
        'solar:emoji-funny-circle-bold',
        'solar:shop-bold',

        // Search & Filters
        'solar:magnifer-bold',
        'solar:text-bold',
        'solar:clock-circle-bold',
        'solar:calendar-add-bold',
        'solar:layers-bold',
        'solar:gamepad-bold',
        'solar:lightbulb-bold',

        // Status & UI
        'solar:danger-triangle-bold',
        'solar:check-circle-bold',
        'solar:info-circle-bold',
        'solar:danger-circle-bold',
        'solar:close-circle-bold',

        // Common UI Elements
        'solar:alt-arrow-down-bold',
        'solar:alt-arrow-up-bold',
        'solar:refresh-bold',
        'solar:stop-bold',
        'solar:folder-bold',
        'solar:download-bold',
        'solar:upload-bold',
        'solar:code-bold',
        'solar:palette-bold',
      ]);
    };

    preloadIcons().catch(console.error);
  }, []);

  useEffect(() => {
    getLauncherConfig()
        .then((config) => {
          if (config && config.profile_grouping_criterion) {
            setCurrentGroupingCriterion(config.profile_grouping_criterion);
          } else {
            setCurrentGroupingCriterion("none");
          }
        })
        .catch((err) => {
          console.error(
              "Failed to get initial profile grouping from config:",
              err,
          );
          setCurrentGroupingCriterion("none");
        });
  }, []);

  const handleProfileGroupingChange = async (newCriterion: string) => {
    setCurrentGroupingCriterion(newCriterion);
    try {
      await setProfileGroupingPreference(newCriterion);
      console.log("[App.tsx] Grouping preference saved successfully.");
    } catch (error) {
      console.error("[App.tsx] Failed to save grouping preference:", error);
      toast.error(t('app.errors.save_grouping'));
    }
  };

  // Analytics consent banner handlers
  const handleAnalyticsAccept = async () => {
    try {
      // Update ThemeStore state
      setAnalyticsConsent({
        hasMadeDecision: true,
        decision: 'accepted',
        hasSeenBanner: true,
        lastShown: new Date().toISOString(),
      });

      // Enable analytics in launcher config
      const currentConfig = await ConfigService.getLauncherConfig();
      await ConfigService.setLauncherConfig({
        ...currentConfig,
        enable_analytics: true,
      });

      // Invalidate analytics cache to reflect the change immediately
      const { invalidateAnalyticsCache } = await import('./services/analytics-service');
      invalidateAnalyticsCache();

      toast.success(t('analytics.toast.enabled'));
    } catch (error) {
      console.error("Failed to enable analytics:", error);
      toast.error(t('analytics.toast.enable_failed'));
    }
  };

  const handleAnalyticsDecline = async () => {
    try {
      // Update ThemeStore state
      setAnalyticsConsent({
        hasMadeDecision: true,
        decision: 'declined',
        hasSeenBanner: true,
        lastShown: new Date().toISOString(),
      });

      // Disable analytics in launcher config
      const currentConfig = await ConfigService.getLauncherConfig();
      await ConfigService.setLauncherConfig({
        ...currentConfig,
        enable_analytics: false,
      });

      // Invalidate analytics cache to reflect the change immediately
      const { invalidateAnalyticsCache } = await import('./services/analytics-service');
      invalidateAnalyticsCache();

      toast.success(t('analytics.toast.disabled'));
    } catch (error) {
      console.error("Failed to disable analytics:", error);
      toast.error(t('analytics.toast.disable_failed'));
    }
  };

  const handleAnalyticsDismiss = () => {
    const newReminderCount = analyticsConsent.reminderCount + 1;
    setAnalyticsConsent({
      hasSeenBanner: true,
      lastShown: new Date().toISOString(),
      reminderCount: newReminderCount,
    });
    toast(t('analytics.toast.dismissed'));
  };

  // Sync analytics state with config on app start
  useEffect(() => {
    const syncAnalyticsWithConfig = async () => {
      try {
        const config = await ConfigService.getLauncherConfig();
        // Update ThemeStore decision based on config
        if (config.enable_analytics && analyticsConsent.decision !== 'accepted') {
          setAnalyticsConsent({
            hasMadeDecision: true,
            decision: 'accepted',
          });
        } else if (!config.enable_analytics && analyticsConsent.decision === 'accepted') {
          setAnalyticsConsent({
            hasMadeDecision: true,
            decision: 'declined',
          });
        }
      } catch (error) {
        console.error("Failed to sync analytics with config:", error);
      }
    };

    syncAnalyticsWithConfig();
  }, []); // Only run once on mount

  // Increment launch count on app start
  useEffect(() => {
    incrementLaunchCount();
  }, [incrementLaunchCount]);

  const handleNavChange = async (tabId: string) => {
    navigate(`/${tabId}`);

    // Track tab clicked only if analytics are enabled
    if (analyticsConsent.decision === 'accepted') {
      trackEvent('sidebar_tab_clicked', { tab_name: tabId }).catch(console.error);
    }
  };

  const profilesTabContext: ProfilesTabContext = {
    currentGroupingCriterion,
    onGroupingChange: handleProfileGroupingChange,
  };

  useGlobalDragAndDrop();

  return (
    <FlagsmithProvider flagsmith={flagsmith}>
      <div className="flex flex-col h-screen w-screen overflow-hidden">
        <ThemeInitializer />
        <ScrollbarProvider />
        <GlobalToaster />
        <GlobalCrashReportModal />
        <TermsOfServiceModal isOpen={!hasAcceptedTermsOfService} />
        <GlobalModalPortal />
        <ChildProtectionModal />
        <NotificationModal />
        <AppLayout activeTab={activeTab} onNavChange={handleNavChange}>
          <Outlet context={profilesTabContext} />
        </AppLayout>
        {shouldShowAnalyticsBanner() && (
          <AnalyticsConsentBanner
            onAccept={handleAnalyticsAccept}
            onDecline={handleAnalyticsDecline}
            onDismiss={handleAnalyticsDismiss}
          />
        )}
      </div>
    </FlagsmithProvider>
  );
}

export function useProfilesTabContext() {
  return useOutletContext<ProfilesTabContext>();
}
