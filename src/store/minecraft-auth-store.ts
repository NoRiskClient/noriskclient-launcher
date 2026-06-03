import { create } from "zustand";
import { MinecraftAuthService } from "../services/minecraft-auth-service";
import type { MinecraftAccount } from "../types/minecraft";
import flagsmith from 'flagsmith';
import { toast } from "react-hot-toast";
import { getLauncherConfig } from "../services/launcher-config-service";
import { refreshPermissions } from "../services/permission-service";
import i18n from '../i18n/i18n';
import { parseErrorMessage } from "../utils/error-utils";

const setMojangTraits = (account: MinecraftAccount | null) => {
  const uuid = account?.id ?? null;
  const username = account?.username ?? null;
  Promise.all([
    flagsmith.setTrait('mojang_uuid', uuid),
    flagsmith.setTrait('mojang_username', username),
  ])
    .then(() => {
      if (uuid) {
        console.log(`[AuthStore] Flagsmith mojang traits set for ${uuid}`);
      } else {
        console.log("[AuthStore] Flagsmith mojang traits cleared (no active account).");
      }
    })
    .catch((error) => {
      console.error("[AuthStore] Error updating Flagsmith mojang traits:", error);
    });

  // Re-fetch permissions whenever the active account changes (token & uuid differ).
  refreshPermissions().catch((error) => {
    console.error("[AuthStore] Error refreshing permissions:", error);
  });
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

      // Commit the (cached) account list first so a failing active-account
      // refresh — e.g. a Mojang auth outage / HTTP 429 — can never wipe the
      // whole list. The cached `active` flag gives us a fallback selection.
      const fallbackActive = accounts.find((a) => a.active) ?? null;
      set({
        accounts,
        activeAccount: fallbackActive,
      });

      let activeAccount = fallbackActive;
      try {
        activeAccount = await MinecraftAuthService.getActiveAccount();
      } catch (refreshError) {
        console.warn(
          "Active account refresh failed, keeping cached account:",
          refreshError,
        );
      }

      const updatedAccounts = accounts.map((account) => ({
        ...account,
        active: activeAccount ? account.id === activeAccount.id : false,
      }));

      set({
        accounts: updatedAccounts,
        activeAccount,
        isLoading: false,
      });
      setMojangTraits(activeAccount);
    } catch (error) {
      console.error("Failed to initialize accounts:", error);
      set({
        error: i18n.t('auth.errors.load_accounts', { error: parseErrorMessage(error) }),
        isLoading: false,
      });
      setMojangTraits(null);
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

      setMojangTraits(activeAccount);

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
        parseErrorMessage(error);
      
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
        setMojangTraits(activeAccount);
      }
    } catch (error) {
      console.error("Failed to remove account:", error);
      set({
        error: i18n.t('auth.errors.remove_account', { error: parseErrorMessage(error) }),
        isLoading: false,
      });
    }
  },

  setActiveAccount: async (accountId: string) => {
    const previousAccount = get().activeAccount;
    const previousAccounts = get().accounts;
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
      setMojangTraits(activeAccount);
    } catch (error) {
      console.error("Failed to set active account:", error);
      const errorMsg = error instanceof Error ? error.message : String((error as any).message ?? error);
      const isExpiredToken = errorMsg.includes("invalid_grant") || errorMsg.includes("expired");

      if (isExpiredToken) {
        try {
          await MinecraftAuthService.removeAccount(accountId);
          const accounts = await MinecraftAuthService.getAccounts();
          const activeAccount = await MinecraftAuthService.getActiveAccount();
          const updatedAccounts = accounts.map((acc) => ({
            ...acc,
            active: activeAccount ? acc.id === activeAccount.id : false,
          }));
          set({
            accounts: updatedAccounts,
            activeAccount,
            isLoading: false,
            error: null,
          });
          setMojangTraits(activeAccount);
        } catch (removeErr) {
          console.error("Failed to remove expired account:", removeErr);
          set({ accounts: previousAccounts, activeAccount: previousAccount, isLoading: false });
        }
        toast.error(i18n.t('auth.errors.session_expired'), { duration: 5000 });
      } else {
        if (previousAccount) {
          try {
            await MinecraftAuthService.setActiveAccount(previousAccount.id);
          } catch (revertErr) {
            console.error("Failed to revert active account in backend:", revertErr);
          }
        }
        set({
          accounts: previousAccounts,
          activeAccount: previousAccount,
          error: i18n.t('auth.errors.set_active', { error: errorMsg }),
          isLoading: false,
        });
        toast.error(i18n.t('auth.errors.switch_failed', { error: errorMsg }), { duration: 3000 });
      }
    }
  },
}));
