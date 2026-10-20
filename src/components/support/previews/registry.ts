import { LoaderUpdatePreview, SwitchPackPreview } from "./ActionPreviews";
import { CrashReportPreview, JvmCrashPreview } from "./CrashPreviews";
import {
  ModListPreview,
  ProfileSummaryPreview,
  RawPreview,
  SystemInfoPreview,
} from "./DataPreviews";
import { LogPreview } from "./LogPreview";
import {
  LOG_RENDER_CAP,
  analyzeLog,
  formatMb,
  itemData,
  joinParts,
  loaderText,
  num,
  parseCrashReport,
  parseJvmCrash,
  parseModList,
  countNrcModules,
  previewText,
  optionValue,
  str,
} from "./parse";
import type { SupportPreviewTemplate } from "./types";
import type { PreparedItem } from "../../../types/support-request";

type Summarize = NonNullable<SupportPreviewTemplate["summarize"]>;

const safe =
  (fn: Summarize): Summarize =>
  (item, t, ctx) => {
    try {
      return fn(item, t, ctx);
    } catch {
      return null;
    }
  };

const logTemplate: SupportPreviewTemplate = {
  Preview: LogPreview,
  summarize: safe((item, t) => {
    const { errors } = analyzeLog(item);
    return errors > 0
      ? t("support_request.summary.log_errors", { count: errors })
      : t("support_request.summary.log_clean");
  }),
};

const PREVIEW_TEMPLATES: Readonly<Record<string, SupportPreviewTemplate>> = {
  MC_LATEST_LOG: logTemplate,
  MC_DEBUG_LOG: logTemplate,
  LAUNCHER_LOG: logTemplate,
  LAST_SESSION_LOG: logTemplate,
  MC_LATEST_CRASH: {
    Preview: CrashReportPreview,
    summarize: safe((item, t) => {
      const info = parseCrashReport(previewText(item));
      const what = info.exception?.split(":")[0]?.split(".").pop() ?? info.description;
      return what ? t("support_request.summary.crash", { what }) : null;
    }),
  },
  JVM_CRASH: {
    Preview: JvmCrashPreview,
    summarize: safe((item, t) => {
      const { module } = parseJvmCrash(previewText(item));
      return module ? t("support_request.summary.jvm_module", { module }) : t("support_request.summary.jvm");
    }),
  },
  MOD_LIST: {
    Preview: ModListPreview,
    summarize: safe((item, t) => {
      const mods = parseModList(item);
      return mods ? t("support_request.summary.mods", { count: mods.length }) : null;
    }),
  },
  PROFILE_SUMMARY: {
    Preview: ProfileSummaryPreview,
    summarize: safe((item) => {
      const d = itemData(item);
      const mc = d && str(d.minecraftVersion);
      return d && joinParts([mc && `Minecraft ${mc}`, loaderText(d)]);
    }),
  },
  SYSTEM_INFO: {
    Preview: SystemInfoPreview,
    summarize: safe((item, t) => {
      const d = itemData(item);
      const ram = d && formatMb(num(d.memoryTotalMb));
      return d && joinParts([str(d.os), ram && t("support_request.summary.ram", { ram })]);
    }),
  },
  MC_SETTINGS: {
    Preview: RawPreview,
    summarize: safe((item, t) => {
      const view = optionValue(item, "renderDistance");
      const fps = optionValue(item, "maxFps");
      return joinParts([view && t("support_request.summary.view", { view }), fps && `${fps} FPS`]);
    }),
  },
  NRC_PROFILE: {
    Preview: RawPreview,
    summarize: safe((item, t) => {
      const modules = countNrcModules(item);
      return modules && t("support_request.summary.modules", modules);
    }),
  },
  UPDATE_LOADER: { Preview: LoaderUpdatePreview },
  SWITCH_PACK: { Preview: SwitchPackPreview },
};

export function getPreviewTemplate(type: string): SupportPreviewTemplate {
  return Object.prototype.hasOwnProperty.call(PREVIEW_TEMPLATES, type) ? PREVIEW_TEMPLATES[type] : {};
}

export function isPartiallyShown(item: PreparedItem): boolean {
  if (item.previewIsExcerpt) return true;
  return getPreviewTemplate(item.type) === logTemplate && analyzeLog(item).lines.length > LOG_RENDER_CAP;
}

export { RawPreview };
