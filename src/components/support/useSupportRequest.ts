import { useCallback, useEffect, useRef, useState } from "react";
import { SupportRequestService, parseSupportRequestError } from "../../services/support-request-service";
import type { SupportErrorKind, SupportRequestInfo } from "../../types/support-request";

export const FATAL_ERRORS: ReadonlySet<SupportErrorKind> = new Set([
  "not_logged_in",
  "not_found",
  "gone",
  "invalid_code",
  "discord_not_linked",
]);

export interface ErrorState {
  kind: SupportErrorKind;
  retry?: () => void;
  otherAccounts?: boolean;
}

export type ShowError = (e: unknown, retry?: () => void) => void;

export function useSupportRequest(code: string) {
  const [info, setInfo] = useState<SupportRequestInfo | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [load, setLoad] = useState({ attempt: 0, otherAccounts: false });
  const fetchedAttempt = useRef<number | null>(null);

  const showError = useCallback<ShowError>((e, retry = () => {}) => {
    const err = parseSupportRequestError(e);
    console.error("[SupportRequest]", err.raw);
    setError({
      kind: err.kind,
      retry: FATAL_ERRORS.has(err.kind) ? undefined : retry,
      otherAccounts: err.otherAccounts,
    });
  }, []);

  useEffect(() => {
    if (fetchedAttempt.current === load.attempt) return;
    fetchedAttempt.current = load.attempt;
    const current = () => fetchedAttempt.current === load.attempt;
    SupportRequestService.fetch(code, load.otherAccounts)
      .then((result) => current() && setInfo(result))
      .catch((e) => current() && showError(e, () => setLoad((l) => ({ ...l, attempt: l.attempt + 1 }))));
  }, [code, load, showError]);

  const tryOtherAccounts = () => {
    setError(null);
    setLoad((l) => ({ attempt: l.attempt + 1, otherAccounts: true }));
  };

  return { info, error, setError, showError, tryOtherAccounts };
}
