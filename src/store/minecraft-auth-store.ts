import { create } from "zustand";
import { MinecraftAuthService } from "../services/minecraft-auth-service";
import type { MinecraftAccount } from "../types/minecraft";
import flagsmith from 'flagsmith';
import { toast } from "react-hot-toast";
import { getLauncherConfig } from "../services/launcher-config-service";
import i18n from '../i18n/i18n';

// Helper function to identify the user with Flagsmith
const identifyWithFlagsmith = (account: MinecraftAccount | null) => {
  if (account && account.id) {
    flagsmith.identify(account.id)
      .then(() => {
        console.log(`[AuthStore] Flagsmith user identified: ${account.id}`);
      })
      .catch((error) => {
        console.error(`[AuthStore] Error identifying Flagsmith user ${account.id}:`, error);
      });
  } else {
    flagsmith.logout()
      .then(() => {
        console.log("[AuthStore] Flagsmith user logged out (no active account).");
      })
      .catch((error) => {
        console.error("[AuthStore] Error logging out Flagsmith user:", error);
      });
  }
};

interface MinecraftAuthState {
  accounts: MinecraftAccount[];
  activeAccount: MinecraftAccount | null;
  isLoading: boolean;
  error: string | null;

  initializeAccounts: () => Promise<void>;
  addAccount: () => Promise<void>;
  removeAccount: (accountId: string) => Promise<void>;
  setActiveAccount: (accountId: string) => Promise<void>;
}

export const useMinecraftAuthStore = create<MinecraftAuthState>((set, get) => ({
  accounts: [],
  activeAccount: null,
  isLoading: false,
  error: null,

  initializeAccounts: async () => {
    try {
      set({ isLoading: true, error: null });

      const accounts = await MinecraftAuthService.getAccounts();

      const activeAccount = await MinecraftAuthService.getActiveAccount();

      const updatedAccounts = accounts.map((account) => ({
        ...account,
        active: activeAccount ? account.id === activeAccount.id : false,
      }));

      set({
        accounts: updatedAccounts,
        activeAccount,
        isLoading: false,
      });
      identifyWithFlagsmith(activeAccount);
    } catch (error) {
      console.error("Failed to initialize accounts:", error);
      set({
        error: i18n.t('auth.errors.load_accounts', { error: error instanceof Error ? error.message : String(error.message) }),
        isLoading: false,
      });
      identifyWithFlagsmith(null);
    }
  },

  addAccount: async () => {
    set({ isLoading: true, error: null });

    // Check if browser-based login is enabled
    const [config, isFlatpak] = await Promise.all([
      getLauncherConfig().catch(() => ({ use_browser_based_login: false })),
      MinecraftAuthService.isFlatpak().catch(() => false),
    ]);
    const useBrowserLogin = isFlatpak || config.use_browser_based_login;

    const fullProcessPromise = (async () => {
      // Step 1: Login
      const newAccount = await MinecraftAuthService.beginLogin();
      if (!newAccount) {
        // This will be caught by toast.promise and the try/catch block
        throw new Error(i18n.t('auth.errors.login_cancelled'));
      }

      // Step 2: Get all data needed for the state update
      const accounts = await MinecraftAuthService.getAccounts();
      const activeAccount = await MinecraftAuthService.getActiveAccount();

      identifyWithFlagsmith(activeAccount);

      // Return a payload with all data needed for the success toast and the final state update
      return { newAccount, accounts, activeAccount };
    })();

    // Use toast.promise only if NOT using browser-based login
    if (!useBrowserLogin) {
      toast.promise(
        fullProcessPromise,
        {
          loading: i18n.t('auth.loading.browser_sign_in'),
          success: ({ newAccount }) =>
            i18n.t('auth.success.account_added', { username: newAccount.username }),
          error: (err) => err.message,
        },
        {
          loading: {
            duration: 50000,
          },
          success: {
            duration: 1500,
          },
          error: {
            duration: 1500,
          },
        },
      );
    }

    // Handle promise completion
    try {
      const { newAccount, accounts, activeAccount } = await fullProcessPromise;

      // Only show success toast if not using browser login (toast.promise already handles it)
      if (useBrowserLogin) {
        toast.success(i18n.t('auth.success.account_added', { username: newAccount.username }), {
          duration: 1500,
        });
      }

      // Update state with all accounts marked correctly
      const updatedAccounts = accounts.map((account) => ({
        ...account,
        active: activeAccount ? account.id === activeAccount.id : false,
      }));

      set({
        accounts: updatedAccounts,
        activeAccount,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error.message);
      
      // Only show error toast if using browser login (toast.promise already handles it)
      if (useBrowserLogin && !errorMessage.includes(i18n.t('auth.errors.login_cancelled'))) {
        toast.error(errorMessage || i18n.t('auth.errors.login_failed'), {
          duration: 1500,
        });
      }
      
      // The toast handles displaying the error. We just log it and set state if it's a critical error.
      if (!errorMessage.includes(i18n.t('auth.errors.login_cancelled'))) {
        console.error("Failed to add account:", error);
        set({ error: i18n.t('auth.errors.add_account', { error: errorMessage }), isLoading: false });
      } else {
        // Already handled by cancel button - ensure loading state is reset
        console.log("Account add cancelled by user.");
        set({ isLoading: false, error: i18n.t('auth.errors.login_cancelled') });
      }
    }
  },

  removeAccount: async (accountId: string) => {
    try {
      set({ isLoading: true, error: null });
      const wasActive = get().activeAccount?.id === accountId;

      await MinecraftAuthService.removeAccount(accountId);

      const accounts = await MinecraftAuthService.getAccounts();
      const activeAccount = await MinecraftAuthService.getActiveAccount();

      const updatedAccounts = accounts.map((account) => ({
        ...account,
        active: activeAccount ? account.id === activeAccount.id : false,
      }));

      set({
        accounts: updatedAccounts,
        activeAccount,
        isLoading: false,
      });
      if (wasActive) {
        identifyWithFlagsmith(activeAccount);
      }
    } catch (error) {
      console.error("Failed to remove account:", error);
      set({
        error: i18n.t('auth.errors.remove_account', { error: error instanceof Error ? error.message : String(error.message) }),
        isLoading: false,
      });
    }
  },

  setActiveAccount: async (accountId: string) => {
    try {
      set({ isLoading: true, error: null });

      await MinecraftAuthService.setActiveAccount(accountId);

      const activeAccount = await MinecraftAuthService.getActiveAccount();

      const updatedAccounts = get().accounts.map((account) => ({
        ...account,
        active: account.id === accountId,
      }));

      set({
        accounts: updatedAccounts,
        activeAccount,
        isLoading: false,
      });
      identifyWithFlagsmith(activeAccount);
    } catch (error) {
      console.error("Failed to set active account:", error);
      set({
        error: i18n.t('auth.errors.set_active', { error: error instanceof Error ? error.message : String(error.message) }),
        isLoading: false,
      });
    }
  },
}));
