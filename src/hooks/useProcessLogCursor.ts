import { useEffect } from "react";
import { useProcessStore } from "../store/useProcessStore";
import { getProcessLogCursor } from "../services/process-service";

const POLL_INTERVAL_MS = 700;
const INGEST_FLUSH_INTERVAL_MS = 150;

export function useProcessLogCursor(
  sessionId: string | null | undefined,
  processId: string | null | undefined,
) {
  useEffect(() => {
    if (!sessionId || !processId) return;
    let cancelled = false;
    let isPolling = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const pendingLines: string[] = [];

    const flushPendingLines = () => {
      flushTimer = null;
      if (cancelled || pendingLines.length === 0) return;

      const lines = pendingLines.splice(0, pendingLines.length);
      useProcessStore.getState().addLogEntriesBatch(
        lines.map((line) => ({ processId, rawMessage: line })),
      );
    };

    const queueLines = (lines: string[]) => {
      if (lines.length === 0) return;
      pendingLines.push(...lines);

      if (flushTimer === null) {
        flushTimer = setTimeout(flushPendingLines, INGEST_FLUSH_INTERVAL_MS);
      }
    };

    const tick = async () => {
      if (cancelled || isPolling) return;
      isPolling = true;
      const store = useProcessStore.getState();
      const cursor = store.cursors.get(processId) ?? 0;
      try {
        const res = await getProcessLogCursor(sessionId, cursor);
        if (cancelled) return;
        if (res.new_file) {
          pendingLines.splice(0, pendingLines.length);
          store.clearLogs(processId);
        }
        if (res.output) {
          queueLines(
            res.output
              .split(/\r?\n/)
              .filter((line) => line.trim().length > 0),
          );
        }
        useProcessStore.getState().setCursor(processId, res.cursor);
      } catch (e) {
        console.error("[useProcessLogCursor] poll failed:", e);
      } finally {
        isPolling = false;
      }
    };

    void tick();
    const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      pendingLines.splice(0, pendingLines.length);
    };
  }, [sessionId, processId]);
}
