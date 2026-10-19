export interface SupportItemDefinition {
  icon: string;
  group: "data" | "action";
}

const SUPPORT_ITEMS: Readonly<Record<string, SupportItemDefinition>> = {
  MC_LATEST_LOG: { icon: "solar:document-text-bold", group: "data" },
  MC_DEBUG_LOG: { icon: "solar:code-bold", group: "data" },
  MC_LATEST_CRASH: { icon: "solar:danger-triangle-bold", group: "data" },
  JVM_CRASH: { icon: "solar:danger-circle-bold", group: "data" },
  LAUNCHER_LOG: { icon: "solar:file-text-bold", group: "data" },
  LAST_SESSION_LOG: { icon: "solar:history-bold", group: "data" },
  MOD_LIST: { icon: "solar:box-bold", group: "data" },
  PROFILE_SUMMARY: { icon: "solar:user-id-bold", group: "data" },
  SYSTEM_INFO: { icon: "solar:monitor-bold", group: "data" },
  MC_SETTINGS: { icon: "solar:settings-bold", group: "data" },
  NRC_PROFILE: { icon: "solar:widget-4-bold", group: "data" },
  UPDATE_LOADER: { icon: "solar:refresh-circle-bold", group: "action" },
  SWITCH_PACK: { icon: "solar:widget-4-bold", group: "action" },
};

export function getSupportItemDefinition(type: string): SupportItemDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(SUPPORT_ITEMS, type) ? SUPPORT_ITEMS[type] : undefined;
}

export const supportItemKey = (type: string, part: "label" | "description" | "question") =>
  `support_request.item.${type}.${part}`;
