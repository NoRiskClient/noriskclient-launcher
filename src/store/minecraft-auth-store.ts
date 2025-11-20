import { create } from "zustand";
import { MinecraftAuthService } from "../services/minecraft-auth-service";
import type { MinecraftAccount } from "../types/minecraft";
import flagsmith from 'flagsmith';
import { toast } from "react-hot-toast";

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
        error: `Failed to load accounts: ${error instanceof Error ? error.message : String(error)}`,
        isLoading: false,
      });
      identifyWithFlagsmith(null);
    }
  },

  addAccount: async () => {
    set({ isLoading: true, error: null });

    const openSystemBrowser = async (url: string) => {
      // try Tauri first, then window.open as fallback
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const tauriShell = await import("@tauri-apps/plugin-shell");
        if (tauriShell && typeof tauriShell.open === "function") {
          await tauriShell.open(url);
          return;
        }
      } catch (e) {
        // ignore
      }

      // Fallback to normal window.open
      try {
        window.open(url, "_blank", "noopener");
      } catch (e) {
        console.error("Failed to open external browser for login:", e);
      }
    };

    const isLinux =
      (typeof process !== "undefined" && (process as any).platform === "linux") ||
      (typeof navigator !== "undefined" && /linux/.test(navigator.userAgent.toLowerCase()));

    const fullProcessPromise = (async () => {
      // Step 1: Login
      // On Linux: prefer opening the system default browser to avoid embedded-webview issues.
      let newAccount: MinecraftAccount | null = null;

      try {
        if (isLinux) {
          // If the service exposes a direct external-start helper, use it
          if (typeof (MinecraftAuthService as any).beginLoginExternal === "function") {
            newAccount = await (MinecraftAuthService as any).beginLoginExternal();
          } else if (typeof (MinecraftAuthService as any).getLoginUrl === "function") {
            // If we can obtain a URL, open it in the system browser and then wait for the normal beginLogin flow
            const url = await (MinecraftAuthService as any).getLoginUrl();
            if (url) {
              await openSystemBrowser(url);
            }
            // After opening external browser, beginLogin may wait/poll for the completed auth
            newAccount = await MinecraftAuthService.beginLogin();
          } else {
            // Fallback: call standard beginLogin (may open embedded window)
            newAccount = await MinecraftAuthService.beginLogin();
          }
        } else {
          // Non-Linux: original behavior
          newAccount = await MinecraftAuthService.beginLogin();
        }
      } catch (err) {
        // propagate error to be handled below
        throw err;
      }

      if (!newAccount) {
        // This will be caught by toast.promise and the try/catch block
        throw new Error("Login cancelled by user.");
      }

      // Step 2: Get all data needed for the state update
      const accounts = await MinecraftAuthService.getAccounts();
      const activeAccount = await MinecraftAuthService.getActiveAccount();

      identifyWithFlagsmith(activeAccount);

      // Return a payload with all data needed for the success toast and the final state update
      return { newAccount, accounts, activeAccount };
    })();

    toast.promise(
      fullProcessPromise,
      {
        loading: "Please sign in via your browser...",
        success: ({ newAccount }) =>
          `Account '${newAccount.username}' added successfully.`,
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

    try {
      const { accounts, activeAccount } = await fullProcessPromise;

      // Now, after the toast has finished, update the state in one go.
      const updatedAccounts = accounts.map((account) => ({
        ...account,
        active: activeAccount ? account.id === activeAccount.id : false,
      }));

      set({
        accounts: updatedAccounts,
        activeAccount,
        error: null,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      // The toast handles displaying the error. We just log it and set state if it's a critical error.
      if (!errorMessage.includes("cancelled by user")) {
        console.error("Failed to add account:", error);
        set({ error: `Failed to add account: ${errorMessage}` });
      } else {
        console.log("Account add cancelled by user.");
      }
    } finally {
      set({ isLoading: false });
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
        error: `Failed to remove account: ${error instanceof Error ? error.message : String(error)}`,
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
        error: `Failed to set active account: ${error instanceof Error ? error.message : String(error)}`,
        isLoading: false,
      });
    }
  },
}));
