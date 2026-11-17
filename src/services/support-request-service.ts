import { invoke } from "@tauri-apps/api/core";
import { parseErrorMessage } from "../utils/error-utils";
import {
  SUPPORT_ERROR_KINDS,
  type PrepareSupportRequestResult,
  type SupportActionResult,
  type SupportErrorKind,
  type SupportRequestInfo,
  type SupportSubmitResult,
} from "../types/support-request";

export const DEEP_LINK_SUPPORT_REQUEST_EVENT = "deep-link-support-request";

export interface SupportRequestErrorInfo {
  kind: SupportErrorKind;
  raw: string;
  otherAccounts: boolean;
}

export function parseSupportRequestError(e: unknown): SupportRequestErrorInfo {
  const raw = parseErrorMessage(e);
  const match = /support:([a-z_]+)/.exec(raw)?.[1] ?? "";
  const kind = (SUPPORT_ERROR_KINDS as readonly string[]).includes(match)
    ? (match as SupportErrorKind)
    : "unknown";
  return { kind, raw, otherAccounts: kind === "not_found" && raw.includes("other_accounts_available") };
}

export const SupportRequestService = {
  fetch: (code: string, tryOtherAccounts = false) =>
    invoke<SupportRequestInfo>("support_request_fetch", { code, tryOtherAccounts }),
  prepare: (code: string, profileId: string, accountId: string) =>
    invoke<PrepareSupportRequestResult>("support_request_prepare", { code, profileId, accountId }),
  executeAction: (code: string, index: number) =>
    invoke<SupportActionResult>("support_request_execute_action", { code, index }),
  submit: (code: string, selection: number[]) =>
    invoke<SupportSubmitResult>("support_request_submit", { code, selection }),
  decline: (code: string) => invoke<void>("support_request_decline", { code }),
  close: (code: string): Promise<void> => invoke<void>("support_request_close", { code }).catch(() => {}),
};
