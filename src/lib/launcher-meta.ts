import type { ExternalLauncherId } from "../types/launcherImport";

const ICONS: Record<ExternalLauncherId, string> = {
  curseforge: "simple-icons:curseforge",
  modrinth_app: "simple-icons:modrinth",
  prism_launcher: "solar:box-bold",
  multimc: "solar:box-minimalistic-bold",
  atlauncher: "solar:widget-bold",
  gdlauncher: "solar:gamepad-bold",
  vanilla_launcher: "solar:widget-4-bold",
};

export function launcherIcon(launcher: ExternalLauncherId): string {
  return ICONS[launcher] ?? "solar:folder-bold";
}
