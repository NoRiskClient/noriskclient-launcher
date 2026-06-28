import { create } from "zustand";

export interface ImportProgress {
  isImporting: boolean;
  currentStep: string;
  progress: number; // 0-100
  fileName: string;
}

interface ImportProgressStore {
  imports: Record<string, ImportProgress>; // key = event_id
  setImportProgress: (id: string, progress: Partial<ImportProgress> & { fileName: string }) => void;
  updateImportProgress: (id: string, progress: number, step?: string) => void;
  clearImport: (id: string) => void;
  getImport: (id: string) => ImportProgress | undefined;
}

const DEFAULT_IMPORT: ImportProgress = {
  isImporting: false,
  currentStep: "",
  progress: 0,
  fileName: "",
};

export const useImportProgressStore = create<ImportProgressStore>((set, get) => ({
  imports: {},

  setImportProgress: (id, progress) => {
    set((state) => ({
      imports: {
        ...state.imports,
        [id]: {
          ...DEFAULT_IMPORT,
          ...state.imports[id],
          ...progress,
          isImporting: true,
        },
      },
    }));
  },

  updateImportProgress: (id, progress, step) => {
    set((state) => {
      const existing = state.imports[id];
      if (!existing) return state;

      return {
        imports: {
          ...state.imports,
          [id]: {
            ...existing,
            progress,
            ...(step !== undefined && { currentStep: step }),
          },
        },
      };
    });
  },

  clearImport: (id) => {
    set((state) => {
      const { [id]: _, ...rest } = state.imports;
      return { imports: rest };
    });
  },

  getImport: (id) => {
    return get().imports[id];
  },
}));
