"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { useMinecraftAuthStore } from "../store/minecraft-auth-store";
import { MinecraftAuthService } from "../services/minecraft-auth-service";
import { getLauncherConfig } from "../services/launcher-config-service";
import { useGlobalModal } from "./useGlobalModal";
import { BrowserLoginModal } from "../components/account/BrowserLoginModal";

const BROWSER_LOGIN_MODAL_ID = "browser-login-modal";

/**
 * The Microsoft sign-in flow, minus the surface it is triggered from.
 *
 * Two things make this worth sharing rather than repeating: whether the login
 * runs in an embedded window or in the system browser is decided by config
 * (and forced on Flatpak), and the browser variant needs its own progress
 * modal opened and torn down around `addAccount()`.
 */
export function useAddMinecraftAccount() {
  const { t } = useTranslation();
  const addAccount = useMinecraftAuthStore((s) => s.addAccount);
  const { showModal, hideModal } = useGlobalModal();
  const [useBrowserLogin, setUseBrowserLogin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const checkBrowserLogin = async () => {
      try {
        const [config, isFlatpakEnv] = await Promise.all([
          getLauncherConfig(),
          MinecraftAuthService.isFlatpak(),
        ]);
        // Use browser login if Flatpak is detected OR if the setting is enabled
        if (!cancelled) setUseBrowserLogin(isFlatpakEnv || config.use_browser_based_login);
      } catch (err) {
        console.error("Failed to load config or check Flatpak:", err);
      }
    };
    checkBrowserLogin();
    return () => {
      cancelled = true;
    };
  }, []);

  const startLogin = useCallback(async () => {
    try {
      if (useBrowserLogin) {
        showModal(
          BROWSER_LOGIN_MODAL_ID,
          <BrowserLoginModal
            onCancel={async () => {
              try {
                await MinecraftAuthService.cancelLogin();
                hideModal(BROWSER_LOGIN_MODAL_ID);
                toast.error(t('auth.loginCancelled'));
                // Reset loading state. No stored error: the toast has already
                // said it, and leaving one behind makes surfaces that render
                // `error` look broken long after the user moved on.
                useMinecraftAuthStore.setState({ isLoading: false, error: null });
              } catch (err) {
                console.error("Failed to cancel login:", err);
                toast.error(t('auth.failedToCancelLogin'));
                // Reset loading state even on error
                useMinecraftAuthStore.setState({ isLoading: false });
              }
            }}
          />
        );
      }
      await addAccount();
      if (useBrowserLogin) {
        hideModal(BROWSER_LOGIN_MODAL_ID);
      }
    } catch (err) {
      console.error("Error adding account:", err);
      if (useBrowserLogin) {
        hideModal(BROWSER_LOGIN_MODAL_ID);
      }
    }
  }, [useBrowserLogin, showModal, hideModal, addAccount, t]);

  return { startLogin, useBrowserLogin };
}
