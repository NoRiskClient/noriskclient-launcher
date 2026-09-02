import { invoke } from "@tauri-apps/api/core";

import type {
  DetectedLauncher,
  ExternalInstancePreview,
  ExternalInstanceRef,
  ExternalLauncherId,
  ImportSelection,
} from "../types/launcherImport";

export async function scanExternalLaunchers(): Promise<DetectedLauncher[]> {
  return invoke<DetectedLauncher[]>("scan_external_launchers");
}

export async function addExternalLauncherRoot(
  path: string,
): Promise<DetectedLauncher | null> {
  return invoke<DetectedLauncher | null>("add_external_launcher_root", {
    params: { path },
  });
}

export async function listExternalInstances(
  launcher: ExternalLauncherId,
  root: string,
): Promise<ExternalInstanceRef[]> {
  return invoke<ExternalInstanceRef[]>("list_external_instances", {
    params: { launcher, root },
  });
}

export async function previewExternalInstance(
  launcher: ExternalLauncherId,
  root: string,
  instanceDir: string,
  options: { selection?: ImportSelection; resolveMods?: boolean } = {},
): Promise<ExternalInstancePreview> {
  return invoke<ExternalInstancePreview>("preview_external_instance", {
    params: {
      launcher,
      root,
      instanceDir,
      selection: options.selection ?? null,
      resolveMods: options.resolveMods ?? false,
    },
  });
}

export interface ImportExternalInstanceArgs {
  launcher: ExternalLauncherId;
  root: string;
  instanceDir: string;
  selection: ImportSelection;
  nameOverride?: string;
  groupOverride?: string;
  noriskPackId?: string;
  clearNoriskPack?: boolean;
  eventId?: string;
}

export async function importExternalInstance(
  args: ImportExternalInstanceArgs,
): Promise<string> {
  return invoke<string>("import_external_instance", { params: args });
}

export async function cancelExternalImport(eventId: string): Promise<boolean> {
  return invoke<boolean>("cancel_external_import", { params: { eventId } });
}
