import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import * as ConfigService from "../services/launcher-config-service";
import { invalidateAnalyticsCache } from "../services/analytics-service";
import { useThemeStore } from "../store/useThemeStore";

type ConsentDecision = "accepted" | "declined";
type ConsentSaveState = { pending: boolean; draft: ConsentDecision | null; error: string | null };

export function useAnalyticsConsentActions() {
  const { t } = useTranslation();
  const [state, setState] = useState<ConsentSaveState>({ pending: false, draft: null, error: null });
  const pendingRef = useRef(false);
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const generation = generationRef.current;
    // Preserve the existing one-time config -> theme synchronization, but never
    // let a late startup read replace an explicit pending/failed user decision.
    const sync = async () => {
      try {
        const config = await ConfigService.getLauncherConfig();
        if (!mountedRef.current || generation !== generationRef.current) return;
        const { analyticsConsent, setAnalyticsConsent } = useThemeStore.getState();
        if (config.enable_analytics && analyticsConsent.decision !== "accepted") {
          setAnalyticsConsent({ hasMadeDecision: true, decision: "accepted" });
        } else if (!config.enable_analytics && analyticsConsent.decision === "accepted") {
          setAnalyticsConsent({ hasMadeDecision: true, decision: "declined" });
        }
      } catch (error) {
        console.error("Failed to sync analytics with config:", error);
      }
    };
    void sync();
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      pendingRef.current = false;
    };
  }, []);

  const saveDecision = async (decision: ConsentDecision): Promise<boolean> => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    const generation = ++generationRef.current;
    const isCurrent = () => mountedRef.current && generation === generationRef.current;
    setState({ pending: true, draft: decision, error: null });
    try {
      const currentConfig = await ConfigService.getLauncherConfig();
      if (!isCurrent()) return false;
      const enableAnalytics = decision === "accepted";
      const savedConfig = await ConfigService.setLauncherConfig({ ...currentConfig, enable_analytics: enableAnalytics });
      if (!isCurrent()) return false;
      if (savedConfig?.enable_analytics !== enableAnalytics) throw new Error("Analytics decision was not confirmed by configuration response");

      // A matching fulfilled SET is the frontend commit boundary. Its response
      // alone does not certify native disk durability or analytics delivery.
      invalidateAnalyticsCache();
      useThemeStore.getState().setAnalyticsConsent({
        hasMadeDecision: true, decision, hasSeenBanner: true, lastShown: new Date().toISOString(),
      });
      toast.success(t(enableAnalytics ? "analytics.toast.enabled" : "analytics.toast.disabled"));
      return true;
    } catch (error) {
      if (isCurrent()) {
        const message = t(decision === "accepted" ? "analytics.toast.enable_failed" : "analytics.toast.disable_failed");
        console.error("Failed to save analytics decision:", error);
        setState({ pending: true, draft: decision, error: message });
        // The banner announces this error inline beside its retry action. A
        // second bottom-right toast would cover that action in the same corner.
      }
      return false;
    } finally {
      if (isCurrent()) {
        pendingRef.current = false;
        setState((previous) => ({ ...previous, pending: false }));
      }
    }
  };

  const dismiss = () => {
    if (pendingRef.current) return;
    const { analyticsConsent, setAnalyticsConsent } = useThemeStore.getState();
    setAnalyticsConsent({ hasSeenBanner: true, lastShown: new Date().toISOString(), reminderCount: analyticsConsent.reminderCount + 1 });
    toast(t("analytics.toast.dismissed"));
  };

  return { ...state, accept: () => saveDecision("accepted"), decline: () => saveDecision("declined"), dismiss };
}
