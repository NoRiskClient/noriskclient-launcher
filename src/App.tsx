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
import { toast } from "react-hot-toast";
import {
  type EventPayload as FrontendEventPayload,
  EventType as FrontendEventType,
  type MinecraftProcessExitedPayload,
} from "./types/events";
import { GlobalCrashReportModal } from "./components/modals/GlobalCrashReportModal";
import { TermsOfServiceModal } from "./components/modals/TermsOfServiceModal";
import { useCrashModalStore } from "./store/crash-modal-store";
import { useThemeStore } from "./store/useThemeStore";
import { refreshNrcDataOnMount } from "./services/nrc-service";
import {
  getLauncherConfig,
  setProfileGroupingPreference,
} from "./services/launcher-config-service";
import { useGlobalDragAndDrop } from './hooks/useGlobalDragAndDrop';

import flagsmith from 'flagsmith';
import { FlagsmithProvider } from 'flagsmith/react';

export type ProfilesTabContext = {
  currentGroupingCriterion: string;
  onGroupingChange: (newCriterion: string) => void;
};

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { openCrashModal } = useCrashModalStore();
  const { hasAcceptedTermsOfService } = useThemeStore();

  const activeTab = location.pathname.substring(1) || "play";

  const [currentGroupingCriterion, setCurrentGroupingCriterion] =
    useState<string>("none");

  const FLAGSMITH_ENVIRONMENT_ID = "eNSibjDaDW2nNJQvJnjj9y"; // User confirmed this is set
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
            toast.error("Could not globally process Minecraft process status.");
          }
        }
      },
    );

    return () => {
      unlisten.then((f) => f());
    };
  }, [openCrashModal]);

  useEffect(() => {
    refreshNrcDataOnMount();
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
      toast.error("Failed to save grouping preference.");
    }
  };

  const handleNavChange = (tabId: string) => {
    navigate(`/${tabId}`);
  };

  const profilesTabContext: ProfilesTabContext = {
    currentGroupingCriterion,
    onGroupingChange: handleProfileGroupingChange,
  };

  useGlobalDragAndDrop();

  return (
    <FlagsmithProvider
      options={{
        environmentID: FLAGSMITH_ENVIRONMENT_ID,
        api: 'https://flagsmith-staging.norisk.gg/api/v1/',
      }}
      flagsmith={flagsmith}
    >
      <div className="flex flex-col h-screen w-screen overflow-hidden">
        <ThemeInitializer />
        <ScrollbarProvider />
        <GlobalToaster />
        <GlobalCrashReportModal />
        <TermsOfServiceModal isOpen={!hasAcceptedTermsOfService} />
        <AppLayout activeTab={activeTab} onNavChange={handleNavChange}>
          <Outlet context={profilesTabContext} />
        </AppLayout>
      </div>
    </FlagsmithProvider>
  );
}

export function useProfilesTabContext() {
  return useOutletContext<ProfilesTabContext>();
}
