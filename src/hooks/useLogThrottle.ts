import { useCallback, useEffect, useRef } from "react";

/**
 * Leaky Bucket / Adaptive Batching for Log Messages
 *
 * Problem: Too many log messages cause UI lag due to frequent React re-renders.
 * Solution:
 * - Burst Mode: First N messages go through immediately
 * - Throttle Mode: When overwhelmed, batch messages and flush periodically
 * - Cooldown: Return to burst mode after period of inactivity
 */

const LOG_THROTTLE_CONFIG = {
  burstLimit: 10,           // Messages that go through immediately
  batchInterval: 100,       // ms between batch flushes
  cooldownTime: 500,        // ms without messages → back to burst mode
};

interface ThrottledLogEntry {
  processId: string;
  rawMessage: string;
}

type AddLogEntryFn = (processId: string, rawMessage: string) => void;
type AddLogEntriesBatchFn = (entries: ThrottledLogEntry[]) => void;

export function useLogThrottle(
  addLogEntry: AddLogEntryFn,
  addLogEntriesBatch: AddLogEntriesBatchFn
) {
  const bufferRef = useRef<ThrottledLogEntry[]>([]);
  const burstCountRef = useRef(0);
  const lastMessageTimeRef = useRef(Date.now());
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flush buffered messages
  const flushBuffer = useCallback(() => {
    if (bufferRef.current.length > 0) {
      addLogEntriesBatch([...bufferRef.current]);
      bufferRef.current = [];
    }
  }, [addLogEntriesBatch]);

  // Start the flush timer if not already running
  const startFlushTimer = useCallback(() => {
    if (!flushTimerRef.current) {
      flushTimerRef.current = setInterval(() => {
        if (bufferRef.current.length > 0) {
          flushBuffer();
        } else {
          // Buffer is empty, stop the timer
          if (flushTimerRef.current) {
            clearInterval(flushTimerRef.current);
            flushTimerRef.current = null;
          }
        }
      }, LOG_THROTTLE_CONFIG.batchInterval);
    }
  }, [flushBuffer]);

  // Reset cooldown timer (called on every message)
  const resetCooldown = useCallback(() => {
    if (cooldownTimerRef.current) {
      clearTimeout(cooldownTimerRef.current);
    }
    cooldownTimerRef.current = setTimeout(() => {
      // No messages for cooldownTime → reset to burst mode
      burstCountRef.current = 0;
    }, LOG_THROTTLE_CONFIG.cooldownTime);
  }, []);

  // Main throttled add function
  const throttledAddLog = useCallback((processId: string, rawMessage: string) => {
    lastMessageTimeRef.current = Date.now();
    resetCooldown();

    // Burst mode: immediate processing
    if (burstCountRef.current < LOG_THROTTLE_CONFIG.burstLimit) {
      burstCountRef.current++;
      addLogEntry(processId, rawMessage);
      return;
    }

    // Throttle mode: add to buffer
    bufferRef.current.push({ processId, rawMessage });
    startFlushTimer();
  }, [addLogEntry, resetCooldown, startFlushTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Flush any remaining buffered messages before unmount
      if (bufferRef.current.length > 0) {
        // Note: This is a best-effort flush, may not always work on unmount
        addLogEntriesBatch([...bufferRef.current]);
        bufferRef.current = [];
      }

      if (flushTimerRef.current) {
        clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (cooldownTimerRef.current) {
        clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    };
  }, [addLogEntriesBatch]);

  return { throttledAddLog };
}
