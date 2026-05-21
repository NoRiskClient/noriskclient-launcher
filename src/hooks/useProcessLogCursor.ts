import { useEffect } from "react";
import { useProcessStore } from "../store/useProcessStore";
import { getProcessLogCursor } from "../services/process-service";

const POLL_INTERVAL_MS = 700;

export function useProcessLogCursor(
  sessionId: string | null | undefined,
  processId: string | null | undefined,
) {
  useEffect(() => {
    if (!sessionId || !processId) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
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
      } catch (e) {
        console.error("[useProcessLogCursor] poll failed:", e);
      }
    };

    void tick();
    const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId, processId]);
}
