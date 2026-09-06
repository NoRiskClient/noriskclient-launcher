import { useLayoutEffect, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import {
  selectReducedMotionEnabled,
  useReducedMotionEnabled,
  useReducedMotionStore,
} from "../store/reduced-motion-store";
import { useThemeStore } from "../store/useThemeStore";
import { useQualitySettingsStore } from "../store/quality-settings-store";
import { useSnowEffectStore } from "../store/snow-effect-store";

function applyReducedMotion(reduced: boolean) {
  document.documentElement.dataset.reducedMotion = String(reduced);

  const reducedMotionState = useReducedMotionStore.getState();

  if (reduced) {
    if (!reducedMotionState.previousSettings) {
      reducedMotionState.setPreviousSettings({
        isBackgroundAnimationEnabled:
          useThemeStore.getState().isBackgroundAnimationEnabled,
        staticBackground: useThemeStore.getState().staticBackground,
        cosmeticRenderer3d:
          useQualitySettingsStore.getState().cosmeticRenderer3d,
        snowEffectEnabled: useSnowEffectStore.getState().isEnabled,
      });
    }

    useThemeStore.setState({
      isBackgroundAnimationEnabled: false,
      staticBackground: true,
    });
    useQualitySettingsStore.setState({ cosmeticRenderer3d: false });
    useSnowEffectStore.setState({ isEnabled: false });
    return;
  }

  const previousSettings = reducedMotionState.previousSettings;
  if (!previousSettings) return;

  useThemeStore.setState({
    isBackgroundAnimationEnabled:
      previousSettings.isBackgroundAnimationEnabled,
    staticBackground: previousSettings.staticBackground,
  });
  useQualitySettingsStore.setState({
    cosmeticRenderer3d: previousSettings.cosmeticRenderer3d,
  });
  useSnowEffectStore.setState({
    isEnabled: previousSettings.snowEffectEnabled,
  });
  reducedMotionState.setPreviousSettings(null);
}

export function initializeReducedMotion() {
  const mediaQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const updateSystemPreference = () => {
    useReducedMotionStore
      .getState()
      .setSystemPrefersReducedMotion(mediaQuery?.matches ?? false);
    applyReducedMotion(
      selectReducedMotionEnabled(useReducedMotionStore.getState()),
    );
  };

  updateSystemPreference();
  mediaQuery?.addEventListener("change", updateSystemPreference);
}

export function ReducedMotionProvider({ children }: { children: ReactNode }) {
  const reduced = useReducedMotionEnabled();

  useLayoutEffect(() => {
    applyReducedMotion(reduced);
  }, [reduced]);

  return (
    <MotionConfig reducedMotion={reduced ? "always" : "never"}>
      {children}
    </MotionConfig>
  );
}
