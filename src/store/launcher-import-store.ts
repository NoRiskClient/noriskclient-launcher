import { create } from "zustand";
import { persist } from "zustand/middleware";

import * as LauncherImportService from "../services/launcher-import-service";
import { parseErrorMessage } from "../utils/error-utils";
import { logError, logInfo } from "../utils/logging-utils";
import {
  isSelectable,
  launcherKey,
  type DetectedLauncher,
  type ExternalInstanceRef,
} from "../types/launcherImport";

type LoadPhase = "idle" | "loading" | "ready" | "error";

interface LauncherImportPrefs {
  manualPaths: string[];
  bannerDismissed: boolean;
  addManualPath: (path: string) => void;
  removeManualPath: (path: string) => void;
  dismissBanner: () => void;
}

export const useLauncherImportPrefs = create<LauncherImportPrefs>()(
  persist(
    (set, get) => ({
      manualPaths: [],
      bannerDismissed: false,
      addManualPath: (path) =>
        set({ manualPaths: [...new Set([...get().manualPaths, path])] }),
      removeManualPath: (path) =>
        set({ manualPaths: get().manualPaths.filter((entry) => entry !== path) }),
      dismissBanner: () => set({ bannerDismissed: true }),
    }),
    { name: "norisk-launcher-import" },
  ),
);

interface LauncherImportState {
  phase: LoadPhase;
  error: string | null;
  launchers: DetectedLauncher[];
  instances: Record<string, ExternalInstanceRef[]>;
  instancePhase: Record<string, LoadPhase>;
  instanceError: Record<string, string | null>;
  collapsed: Record<string, boolean>;
  selected: string[];
  importedThisSession: Record<string, string>;
  search: string;

  scan: () => Promise<void>;
  loadInstances: (key: string) => Promise<void>;
  toggleCollapsed: (key: string) => Promise<void>;
  addManualFolder: (path: string) => Promise<DetectedLauncher | null>;
  removeManualLauncher: (key: string) => void;
  toggleInstance: (instanceDir: string) => void;
  toggleLauncher: (key: string) => Promise<void>;
  clearSelection: () => void;
  setSelected: (dirs: string[]) => void;
  markImported: (instanceDir: string, profileId: string) => void;
  setSearch: (value: string) => void;
  reset: () => void;
}

const EMPTY_STATE = {
  phase: "idle" as LoadPhase,
  error: null,
  launchers: [] as DetectedLauncher[],
  instances: {} as Record<string, ExternalInstanceRef[]>,
  instancePhase: {} as Record<string, LoadPhase>,
  instanceError: {} as Record<string, string | null>,
  collapsed: {} as Record<string, boolean>,
  selected: [] as string[],
  search: "",
};

function initialCollapsed(launchers: DetectedLauncher[]): Record<string, boolean> {
  const totalInstances = launchers.reduce(
    (sum, launcher) => sum + launcher.instanceCount,
    0,
  );
  const expandAll = launchers.length <= 2 || totalInstances <= 8;

  return Object.fromEntries(
    launchers.map((launcher, index) => [
      launcherKey(launcher),
      expandAll ? false : index > 0,
    ]),
  );
}

export const useLauncherImportStore = create<LauncherImportState>((set, get) => ({
  ...EMPTY_STATE,
  importedThisSession: {},

  scan: async () => {
    set({ phase: "loading", error: null });

    try {
      const detected = await LauncherImportService.scanExternalLaunchers();
      const manual: DetectedLauncher[] = [];

      for (const path of useLauncherImportPrefs.getState().manualPaths) {
        if (detected.some((entry) => entry.root === path)) continue;
        try {
          const found = await LauncherImportService.addExternalLauncherRoot(path);
          if (found) manual.push(found);
        } catch (err) {
          logError(
            `[LauncherImport] Manual root '${path}' failed: ${parseErrorMessage(err)}`,
          );
        }
      }

      const launchers = [...detected, ...manual];
      const collapsed = initialCollapsed(launchers);

      logInfo(`[LauncherImport] Found ${launchers.length} launchers`);
      set({ phase: "ready", launchers, collapsed });

      await Promise.all(
        launchers
          .map(launcherKey)
          .filter((key) => !collapsed[key])
          .map((key) => get().loadInstances(key)),
      );
    } catch (err) {
      const error = parseErrorMessage(err);
      logError(`[LauncherImport] Scan failed: ${error}`);
      set({ phase: "error", error });
    }
  },

  loadInstances: async (key) => {
    const launcher = get().launchers.find((entry) => launcherKey(entry) === key);
    const phase = get().instancePhase[key];
    if (!launcher || phase === "loading" || phase === "ready") return;

    set((state) => ({
      instancePhase: { ...state.instancePhase, [key]: "loading" },
      instanceError: { ...state.instanceError, [key]: null },
    }));

    try {
      const instances = await LauncherImportService.listExternalInstances(
        launcher.launcher,
        launcher.root,
      );
      set((state) => ({
        instances: { ...state.instances, [key]: instances },
        instancePhase: { ...state.instancePhase, [key]: "ready" },
      }));
    } catch (err) {
      const error = parseErrorMessage(err);
      logError(`[LauncherImport] Listing '${key}' failed: ${error}`);
      set((state) => ({
        instancePhase: { ...state.instancePhase, [key]: "error" },
        instanceError: { ...state.instanceError, [key]: error },
      }));
    }
  },

  toggleCollapsed: async (key) => {
    const next = !get().collapsed[key];
    set((state) => ({ collapsed: { ...state.collapsed, [key]: next } }));
    if (!next) await get().loadInstances(key);
  },

  addManualFolder: async (path) => {
    const found = await LauncherImportService.addExternalLauncherRoot(path);
    if (!found) return null;

    useLauncherImportPrefs.getState().addManualPath(found.root);
    if (get().launchers.some((entry) => entry.root === found.root)) return found;

    const key = launcherKey(found);
    set((state) => ({
      launchers: [...state.launchers, found],
      collapsed: { ...state.collapsed, [key]: false },
    }));
    await get().loadInstances(key);

    return found;
  },

  removeManualLauncher: (key) => {
    const launcher = get().launchers.find((entry) => launcherKey(entry) === key);
    if (!launcher) return;

    useLauncherImportPrefs.getState().removeManualPath(launcher.root);

    const removed = new Set(
      (get().instances[key] ?? []).map((instance) => instance.instanceDir),
    );

    set((state) => ({
      launchers: state.launchers.filter((entry) => launcherKey(entry) !== key),
      selected: state.selected.filter((dir) => !removed.has(dir)),
    }));
  },

  toggleInstance: (instanceDir) =>
    set((state) => ({
      selected: state.selected.includes(instanceDir)
        ? state.selected.filter((entry) => entry !== instanceDir)
        : [...state.selected, instanceDir],
    })),

  toggleLauncher: async (key) => {
    await get().loadInstances(key);

    const { instances, importedThisSession, selected } = get();
    const dirs = (instances[key] ?? [])
      .filter((instance) => isSelectable(instance, importedThisSession))
      .map((instance) => instance.instanceDir);

    const current = new Set(selected);
    const allSelected = dirs.length > 0 && dirs.every((dir) => current.has(dir));

    dirs.forEach((dir) => (allSelected ? current.delete(dir) : current.add(dir)));
    set({ selected: [...current] });
  },

  clearSelection: () => set({ selected: [] }),

  setSelected: (dirs) => set({ selected: [...new Set(dirs)] }),

  markImported: (instanceDir, profileId) =>
    set((state) => ({
      importedThisSession: { ...state.importedThisSession, [instanceDir]: profileId },
      selected: state.selected.filter((entry) => entry !== instanceDir),
    })),

  setSearch: (value) => set({ search: value }),

  reset: () => set({ ...EMPTY_STATE }),
}));
