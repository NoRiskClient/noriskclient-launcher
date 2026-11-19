import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface AdRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AdSize {
  width: number;
  height: number;
}

export const refreshAds = () => invoke<Record<string, AdSize>>("ads_refresh");

export const setAdBounds = (slot: string, rect: AdRect) =>
  invoke<void>("ads_set_bounds", { slot, rect });

export const hideAd = (slot: string) => invoke<void>("ads_hide", { slot });

export const coverAd = (slot: string) => invoke<void>("ads_cover", { slot });

export const showAdConsent = () => invoke<void>("ads_show_consent");

export interface AdStatus {
  personalized: boolean | null;
}

export const getAdStatus = () => invoke<AdStatus>("ads_status");

export const onAdStatusChanged = (handler: () => void) => listen("ads_status_changed", handler);

export type AdConsentMode = "closed" | "prompt" | "dialog";

export type AdConsentAnswer = "accept" | "reject" | "customize";

export const onAdConsentMode = (handler: (mode: AdConsentMode) => void) =>
  listen<AdConsentMode>("ads_consent_mode", (event) => handler(event.payload));

export const answerAdConsent = (action: AdConsentAnswer) => invoke<void>("ads_consent_action", { action });

