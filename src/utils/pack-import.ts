import * as ProfileService from "../services/profile-service";
import { runTrackedImport } from "./tracked-import";

export interface PackImportOverrides {
  name?: string;
  group?: string;
  noriskPackId?: string;
  clearNoriskPack?: boolean;
}

export async function runPackImport(
  filePath: string,
  overrides: PackImportOverrides = {},
): Promise<string | null> {
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;

  return runTrackedImport<string>({
    dedupeKey: filePath,
    label: fileName,
    run: (eventId) =>
      ProfileService.importProfileByPath(
        filePath,
        eventId,
        overrides.name,
        overrides.group,
        overrides.noriskPackId,
        overrides.clearNoriskPack,
      ),
  });
}
