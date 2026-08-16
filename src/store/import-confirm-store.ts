import { create } from "zustand";
import { toast } from "react-hot-toast";

import * as ProfileService from "../services/profile-service";
import { parseErrorMessage } from "../utils/error-utils";
import { logError, logInfo } from "../utils/logging-utils";
import type { ImportPackPreview } from "../types/importPreview";
import i18n from "../i18n/i18n";

interface ImportConfirmState {
  isOpen: boolean;
  isLoading: boolean;
  preview: ImportPackPreview | null;
  filePath: string | null;
  requestImport: (filePath: string) => Promise<void>;
  close: () => void;
}

export const useImportConfirmStore = create<ImportConfirmState>((set, get) => ({
  isOpen: false,
  isLoading: false,
  preview: null,
  filePath: null,

  requestImport: async (filePath) => {
    set({ isOpen: true, isLoading: true, preview: null, filePath });
    try {
      const preview = await ProfileService.previewImportPack(filePath);
      if (get().filePath !== filePath) return;
      logInfo(
        `[PackImport] Preview for '${preview.fileName}': ${preview.modCount} mods, ` +
          `${preview.security.rejectedMods.length} rejected entries`,
      );
      set({ preview, isLoading: false });
    } catch (err) {
      const errorMessage = parseErrorMessage(err);
      logError(`[PackImport] Failed to preview '${filePath}': ${errorMessage}`);
      if (get().filePath !== filePath) return;
      set({ isOpen: false, isLoading: false, preview: null, filePath: null });
      toast.error(i18n.t("profiles.import.preview_failed", { error: errorMessage }));
    }
  },

  close: () => set({ isOpen: false, isLoading: false, preview: null, filePath: null }),
}));
