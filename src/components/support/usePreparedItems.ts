import { useEffect, useMemo, useRef, useState } from "react";
import { SupportRequestService, parseSupportRequestError } from "../../services/support-request-service";
import type { PreparedItem } from "../../types/support-request";
import { getSupportItemDefinition } from "./supportItems";
import { FATAL_ERRORS, type ShowError } from "./useSupportRequest";

export type ActionPhase = "running" | "done" | "failed" | "declined";

const ACTION_BUSY_RETRIES = 10;
const ACTION_BUSY_DELAY_MS = 1500;

const isUsable = (item: PreparedItem, group: "data" | "action") =>
  getSupportItemDefinition(item.type)?.group === group && item.supported && item.available;

export const isCollectSelectable = (item: PreparedItem) => item.category === "COLLECT" && isUsable(item, "data");

export function usePreparedItems({
  code,
  accountId,
  profileId,
  active,
  showError,
}: {
  code: string;
  accountId: string | undefined;
  profileId: string | null;
  active: boolean;
  showError: ShowError;
}) {
  const [prepared, setPrepared] = useState<PreparedItem[] | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [actions, setActions] = useState<Record<number, ActionPhase>>({});
  const seq = useRef(0);
  const preparedKey = useRef<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active || !accountId || !profileId) return;
    const key = `${profileId}:${attempt}`;
    if (preparedKey.current === key) return;
    preparedKey.current = key;
    const mySeq = ++seq.current;
    setPreparing(true);
    setPrepared(null);
    setActions({});
    SupportRequestService.prepare(code, profileId, accountId)
      .then((result) => {
        if (mySeq !== seq.current) return;
        const items = [...result.items].sort((a, b) => a.index - b.index);
        setPrepared(items);
        setSelected(new Set(items.filter(isCollectSelectable).map((i) => i.index)));
      })
      .catch((e) => mySeq === seq.current && showError(e, () => setAttempt((n) => n + 1)))
      .finally(() => mySeq === seq.current && setPreparing(false));
  }, [active, code, accountId, profileId, attempt, showError]);

  const groups = useMemo(() => {
    const all = prepared ?? [];
    const data = all.filter((i) => getSupportItemDefinition(i.type)?.group !== "action");
    return {
      dataItems: data.filter(isCollectSelectable),
      missingItems: data.filter((i) => getSupportItemDefinition(i.type) && i.supported && !i.available),
      unsupportedCount: all.filter((i) => !getSupportItemDefinition(i.type) || !i.supported).length,
      runnableActions: all.filter((i) => isUsable(i, "action")),
    };
  }, [prepared]);

  const selection = useMemo(() => {
    const ran = Object.entries(actions)
      .filter(([, phase]) => phase === "done" || phase === "failed")
      .map(([index]) => Number(index));
    return [...new Set([...selected, ...ran])].sort((a, b) => a - b);
  }, [selected, actions]);

  const setPhase = (index: number, phase: ActionPhase) => setActions((prev) => ({ ...prev, [index]: phase }));

  const runAction = async (index: number) => {
    setPhase(index, "running");
    for (let i = 0; i < ACTION_BUSY_RETRIES && alive.current; i++) {
      try {
        const result = await SupportRequestService.executeAction(code, index);
        setPhase(index, result.status === "DONE" ? "done" : "failed");
        return;
      } catch (e) {
        const err = parseSupportRequestError(e);
        if (err.kind === "busy") {
          await new Promise((resolve) => setTimeout(resolve, ACTION_BUSY_DELAY_MS));
          continue;
        }
        if (FATAL_ERRORS.has(err.kind)) showError(e);
        else console.error("[SupportRequest] action failed:", err.raw);
        break;
      }
    }
    setPhase(index, "failed");
  };

  const toggleSelected = (index: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return {
    prepared,
    preparing,
    ...groups,
    selected,
    toggleSelected,
    selection,
    actions,
    actionRunning: Object.values(actions).includes("running"),
    actionsTouched: Object.keys(actions).length > 0,
    runAction,
    declineAction: (index: number) => setPhase(index, "declined"),
  };
}

export type PreparedItems = ReturnType<typeof usePreparedItems>;
