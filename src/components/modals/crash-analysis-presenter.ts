import type { TFunction } from "i18next";
import type { CrashAction, CrashCheckResult } from "../../types/crash-analysis";

// Single source of truth for how a crash verdict + its actions are presented.
// Keeps the modal dumb: it only renders what these helpers return.

export type Look = {
  color: string;
  icon: string;
  headlineKey: string;
  btn: "success" | "info" | "warning" | "default";
};

export function look(r: CrashCheckResult): Look {
  if (r.status === "investigating")
    return { color: "#f59e0b", icon: "solar:hammer-bold", headlineKey: "crash_analysis.headline.investigating", btn: "warning" };
  // our bug, not yet in the wiki -> a genuinely new find. Celebrate + thank the reporter.
  if (r.classification === "nrc-own" && !r.known)
    return { color: "#fbbf24", icon: "solar:cup-star-bold", headlineKey: "crash_analysis.headline.new_bug", btn: "warning" };
  if (r.source === "wiki")
    return { color: "#10b981", icon: "solar:check-circle-bold", headlineKey: "crash_analysis.headline.known", btn: "success" };
  if (r.source === "auto")
    return { color: "#3b82f6", icon: "solar:lightbulb-bolt-bold", headlineKey: "crash_analysis.headline.suggested", btn: "info" };
  return { color: "#9ca3af", icon: "solar:inbox-line-bold", headlineKey: "crash_analysis.headline.logged", btn: "default" };
}

// apply CTA is always green — signals "this fixes it"
export const actionVariant = (_a: CrashAction): "success" => "success";

export const actionIcon = (a: CrashAction): string =>
  a.type === "resolve_conflict" ? "solar:link-broken-minimalistic-bold"
    : a.type === "enable_norisk_mod" || a.type === "enable_mod" ? "solar:bolt-circle-bold"
      : a.type === "disable_mod" || a.type === "disable_norisk_mod" ? "solar:power-bold"
        : a.type === "install_mod" ? "solar:download-minimalistic-bold"
          : "solar:refresh-bold";

const conflictMods = (a: CrashAction): string => (a.targets?.length ? a.targets : [a.target]).join(" + ");

// removal is destructive -> red; everything else carries the status accent
export const actionColor = (a: CrashAction, accent: string): string =>
  a.type === "disable_mod" ? "#ef4444" : accent;

// backend ships facts; the launcher composes the localized button label
export function actionLabel(a: CrashAction, t: TFunction): string {
  if (a.type === "resolve_conflict") return t("crash_analysis.action.resolve_conflict", { mods: conflictMods(a) });
  if (a.type === "enable_norisk_mod") return t("crash_analysis.action.enable_norisk_mod", { mod: a.target });
  if (a.type === "disable_norisk_mod") return t("crash_analysis.action.disable_norisk_mod", { mod: a.target });
  if (a.type === "enable_mod") return t("crash_analysis.action.enable_mod", { mod: a.target });
  const version = a.targetVersion ?? "latest";
  if (a.type === "update_loader" || a.type === "update_mod")
    return t("crash_analysis.action.update_mod", { mod: a.target, version });
  if (a.type === "install_mod") return t("crash_analysis.action.install_mod", { mod: a.target, version });
  if (a.type === "disable_mod") return t("crash_analysis.action.disable_mod", { mod: a.target });
  return a.label ?? a.type;
}

// info-only status line (no actions): localized, derived from status + classification.
export function statusMessageText(r: CrashCheckResult, t: TFunction): string | null {
  if (r.actions.length > 0) return null;
  if (r.status === "investigating") return t("crash_analysis.status.investigating");
  if (r.classification === "nrc-own" && !r.known) return t("crash_analysis.status.new_nrc_bug");
  if (r.classification === "nrc-own") return t("crash_analysis.status.nrc_own");
  return t("crash_analysis.status.logged");
}

// summary line: one fix -> derive localized text from its facts; several -> a generic line.
export function summaryText(r: CrashCheckResult, t: TFunction): string | null {
  const primary = r.actions[0];
  if (primary?.type === "resolve_conflict") return t("crash_analysis.summary.conflict", { mods: conflictMods(primary) });
  if (r.actions.length > 1 && r.actions.every((a) => a.type === "disable_mod"))
    return t("crash_analysis.summary.disable_one", { mods: r.actions.map((a) => a.target).join(" / ") });
  if (r.actions.length > 1) return t("crash_analysis.summary.multi", { count: r.actions.length });
  if (primary?.type === "update_loader" || primary?.type === "update_mod") {
    return primary.currentVersion
      ? t("crash_analysis.summary.loader_outdated", { mod: primary.target, current: primary.currentVersion, target: primary.targetVersion ?? "latest" })
      : t("crash_analysis.summary.loader_update", { mod: primary.target, target: primary.targetVersion ?? "latest" });
  }
  if (primary?.type === "install_mod")
    return t("crash_analysis.summary.install", { mod: primary.target, target: primary.targetVersion ?? "latest" });
  if (primary?.type === "disable_mod") return t("crash_analysis.summary.disable_mod", { mod: primary.target });
  if (primary?.type === "enable_norisk_mod") return t("crash_analysis.summary.enable_norisk_mod", { mod: primary.target });
  if (primary?.type === "enable_mod") return t("crash_analysis.summary.enable_mod", { mod: primary.target });
  return r.summary;
}
