import type { PreparedItem } from "../../types/support-request";
import { LOG_RENDER_CAP, analyzeLog } from "./previews/parse";
import { logTemplate, templates } from "./previews/registry";
import type { SupportPreviewTemplate } from "./previews/types";

export type SupportItemGroup = "data" | "action" | "share";

export interface SupportItemDefinition {
  icon: string;
  group: SupportItemGroup;
  preview?: SupportPreviewTemplate;
  needsProfile?: false;
}

const SUPPORT_ITEMS: Readonly<Record<string, SupportItemDefinition>> = {
  MC_LATEST_LOG: { icon: "solar:document-text-bold", group: "data", preview: logTemplate },
  MC_DEBUG_LOG: { icon: "solar:code-bold", group: "data", preview: logTemplate },
  MC_LATEST_CRASH: { icon: "solar:danger-triangle-bold", group: "data", preview: templates.MC_LATEST_CRASH },
  JVM_CRASH: { icon: "solar:danger-circle-bold", group: "data", preview: templates.JVM_CRASH },
  LAUNCHER_LOG: { icon: "solar:file-text-bold", group: "data", preview: logTemplate },
  LAST_SESSION_LOG: { icon: "solar:history-bold", group: "data", preview: logTemplate },
  MOD_LIST: { icon: "solar:box-bold", group: "data", preview: templates.MOD_LIST },
  PROFILE_SUMMARY: { icon: "solar:user-id-bold", group: "data", preview: templates.PROFILE_SUMMARY },
  SYSTEM_INFO: { icon: "solar:monitor-bold", group: "data", preview: templates.SYSTEM_INFO },
  MC_SETTINGS: { icon: "solar:settings-bold", group: "data", preview: templates.MC_SETTINGS },
  NRC_PROFILE: { icon: "solar:widget-4-bold", group: "data", preview: templates.NRC_PROFILE },
  UPDATE_LOADER: { icon: "solar:refresh-circle-bold", group: "action", preview: templates.UPDATE_LOADER },
  SWITCH_PACK: { icon: "solar:widget-4-bold", group: "action", preview: templates.SWITCH_PACK },
  START_TEMP_PROFILE: { icon: "solar:test-tube-bold", group: "action", preview: templates.START_TEMP_PROFILE, needsProfile: false },
  PROFILE_SNAPSHOT: { icon: "solar:folder-with-files-bold", group: "share" },
};

export function getSupportItemDefinition(type: string): SupportItemDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(SUPPORT_ITEMS, type) ? SUPPORT_ITEMS[type] : undefined;
}

export const needsProfile = (type: string) => getSupportItemDefinition(type)?.needsProfile !== false;

export const requestNeedsProfile = (items: readonly { type: string }[]) => items.some((i) => needsProfile(i.type));

export function getPreviewTemplate(type: string): SupportPreviewTemplate {
  return getSupportItemDefinition(type)?.preview ?? {};
}

export function isPartiallyShown(item: PreparedItem): boolean {
  if (item.previewIsExcerpt) return true;
  return getPreviewTemplate(item.type) === logTemplate && analyzeLog(item).lines.length > LOG_RENDER_CAP;
}

export type SupportItemTextPart = "label" | "description" | "question" | "running" | "yes" | "no" | "done" | "failed";

export const supportItemKey = (type: string, part: SupportItemTextPart) =>
  `support_request.item.${type}.${part}`;
