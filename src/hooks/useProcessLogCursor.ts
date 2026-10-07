import { useCallback, useEffect, useRef, useState } from "react";
import { useProcessStore } from "../store/useProcessStore";
import { getProcessLogCursor } from "../services/process-service";
import { logError } from "../utils/logging-utils";
import { parseErrorMessage } from "../utils/error-utils";

const POLL_INTERVAL_MS = 700;

export function useProcessLogCursor(
  sessionId: string | null | undefined,
  processId: string | null | undefined,
) {
  const identity = sessionId && processId ? `${sessionId}\0${processId}` : null;
  const [status, setStatus] = useState<{ identity: string | null; error: string | null; isLoading: boolean }>({ identity: null, error: null, isLoading: false });
  const pollRef = useRef<(() => Promise<void>) | null>(null);
  const retry = useCallback(() => { void pollRef.current?.(); }, []);
  useEffect(() => {
    if (!sessionId || !processId) return;
    let cancelled = false;
    let isPolling = false;
    let hasRead = false;
    setStatus({ identity, error: null, isLoading: true });

    const tick = async () => {
      if (cancelled || isPolling) return;
      isPolling = true;
      // Keep the last failure visible while retrying, without flickering cached logs.
      if (!hasRead) setStatus(previous => previous.isLoading ? previous : { ...previous, isLoading: true });
      const store = useProcessStore.getState();
      const cursor = store.cursors.get(processId) ?? 0;
      try {
        const res = await getProcessLogCursor(sessionId, cursor);
        if (cancelled) return;
        if (res.new_file) {
          store.clearLogs(processId);
        }
        if (res.output) {
          const entries = res.output
            .split(/\r?\n/)
            .filter((line) => line.trim().length > 0)
            .map((line) => ({ processId, rawMessage: line }));
          if (entries.length > 0) {
            useProcessStore.getState().addLogEntriesBatch(entries);
          }
        }
        useProcessStore.getState().setCursor(processId, res.cursor);
        hasRead = true;
        setStatus(previous => previous.identity === identity && previous.error === null && !previous.isLoading
          ? previous : { identity, error: null, isLoading: false });
      } catch (e) {
        if (cancelled) return;
        logError(`[useProcessLogCursor] poll for session ${sessionId} failed: ${e}`);
        // Failed reads neither erase cached output nor advance the cursor.
        const error = parseErrorMessage(e);
        setStatus(previous => previous.identity === identity && previous.error === error && !previous.isLoading
          ? previous : { identity, error, isLoading: false });
      } finally {
        isPolling = false;
      }
    };

    pollRef.current = tick;
    void tick();
    const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollRef.current === tick) pollRef.current = null;
      clearInterval(interval);
    };
  }, [sessionId, processId, identity]);

  return { error: status.identity === identity ? status.error : null,
    isLoading: Boolean(identity) && (status.identity !== identity || status.isLoading), retry };
}
