import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openExternalUrl } from "./tauri-service";

export interface CrashLogShareResult {
  copied: boolean;
  opened: boolean;
  copyError?: unknown;
  openError?: unknown;
}

/**
 * Independent native outcomes. Never turn a rejected clipboard/opener into success.
 * isActive prevents further actions after a crash changes; an already-started native call cannot be undone.
 */
export async function shareCrashLogLink(url: string, isActive: () => boolean = () => true): Promise<CrashLogShareResult> {
  const result: CrashLogShareResult = { copied: false, opened: false };
  if (!isActive()) return result;
  try { await writeText(url); result.copied = true; }
  catch (error) { result.copyError = error; }
  if (!isActive()) return result;
  try { await openExternalUrl(url); result.opened = true; }
  catch (error) { result.openError = error; }
  return result;
}

export function crashLogShareMessageKey(result: CrashLogShareResult, analysisFailed: boolean): string {
  if (analysisFailed) {
    if (result.copied && result.opened) return "crash_modal.toast.analyze_failed";
    if (result.copied) return "crash_modal.toast.analyze_failed_copied_open_failed";
    if (result.opened) return "crash_modal.toast.analyze_failed_opened";
    return "crash_modal.toast.analyze_failed_share_failed";
  }
  if (result.copied && result.opened) return "crash_modal.toast.url_copied";
  if (result.copied) return "crash_modal.toast.url_copied_open_failed";
  if (result.opened) return "crash_modal.toast.url_opened";
  return "crash_modal.toast.link_share_failed";
}
