// Contract for the backend crashlog-check response and the launcher-side crash-fix actions.
// Shared by the analysis modal, its presenter and the crash-fix service.

export type CrashSource = "wiki" | "auto" | "none";
export type CrashStatus = "solved" | "investigating" | null;

export interface CrashAction {
  type: "disable_mod" | "enable_mod" | "update_loader" | "update_mod" | "install_mod" | "resolve_conflict" | "enable_norisk_mod" | "disable_norisk_mod" | string;
  target: string; // mod id / loader name (resolve_conflict: first of targets)
  label?: string | null; // optional fallback prose; launcher builds localized label from fields below
  scope: "profile" | "global";
  source: CrashSource;
  currentVersion?: string | null; // update_loader: installed version
  targetVersion?: string | null; // update_loader: version to update to
  targets?: string[]; // resolve_conflict: all mods in the incompatible set
  direction?: "upgrade" | "downgrade"; // resolve_conflict: set by the modal at apply time
}

export interface CrashCheckResult {
  logId: string;
  classification: string; // clean | nrc-own | third-party | general | unknown
  known: boolean; // matched a wiki entry?
  source: CrashSource; // where the fix came from
  status: CrashStatus; // wiki status if known
  title: string | null;
  wikiUrl: string | null;
  issueUrl?: string | null; // link to the tracking issue on norisk.gg/issues/N (from the wiki entry)
  summary: string | null;
  statusMessage: string | null;
  actions: CrashAction[];
  blamer: string | null; // top NRC frame / culprit location
  module?: string | null; // failing NRC feature/module, humanized (e.g. "Borderless Fullscreen")
  rootCause: string | null;
  culpritMods: string[];
  workaround?: string | null; // temporary remedy text from the wiki entry (authored)
  loaderGenerationMismatch?: boolean; // mods built for a different MC/Forge generation (e.g. Polyfrost on 1.7.10)
}
