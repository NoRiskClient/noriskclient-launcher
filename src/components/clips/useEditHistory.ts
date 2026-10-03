import { useCallback, useEffect, useRef, useState } from "react";

import { useGlobalModalStore } from "../../hooks/useGlobalModal";

const LIMIT = 100;

export function typing(): boolean {
  const focused = document.activeElement;
  if (focused instanceof HTMLTextAreaElement) return true;
  if (focused instanceof HTMLInputElement) return focused.type !== "range";
  return focused instanceof HTMLElement && focused.isContentEditable;
}

export function useEditHistory<T>(
  doc: T,
  apply: (doc: T) => void,
  enabled: boolean,
  paused = false,
) {
  const base = useRef({ doc, text: JSON.stringify(doc) });
  const stacks = useRef<{ past: T[]; future: T[] }>({ past: [], future: [] });
  const pressed = useRef(false);
  const [epoch, setEpoch] = useState(0);
  const [release, setRelease] = useState(0);
  const [depth, setDepth] = useState({ past: 0, future: 0 });

  const sync = useCallback(
    () => setDepth({ past: stacks.current.past.length, future: stacks.current.future.length }),
    [],
  );

  const rebase = useCallback(() => setEpoch((current) => current + 1), []);

  useEffect(() => {
    base.current = { doc, text: JSON.stringify(doc) };
    stacks.current = { past: [], future: [] };
    sync();
  }, [epoch, sync]);

  useEffect(() => {
    if (!enabled || pressed.current || typing()) return;
    const text = JSON.stringify(doc);
    if (text === base.current.text) return;
    stacks.current.past.push(base.current.doc);
    if (stacks.current.past.length > LIMIT) stacks.current.past.shift();
    stacks.current.future = [];
    base.current = { doc, text };
    sync();
  }, [doc, enabled, release, sync]);

  useEffect(() => {
    const down = () => {
      pressed.current = true;
    };
    const up = () => {
      pressed.current = false;
      setRelease((current) => current + 1);
    };
    const move = (event: PointerEvent) => {
      if (pressed.current && event.buttons === 0) up();
    };
    const leave = () => setRelease((current) => current + 1);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    window.addEventListener("lostpointercapture", up, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("blur", up);
    window.addEventListener("focusout", leave, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("lostpointercapture", up, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("blur", up);
      window.removeEventListener("focusout", leave, true);
    };
  }, []);

  const step = useCallback(
    (from: T[], to: T[]) => {
      if (!enabled || pressed.current) return;
      const target = from.pop();
      if (target === undefined) return;
      to.push(base.current.doc);
      base.current = { doc: target, text: JSON.stringify(target) };
      apply(target);
      sync();
    },
    [apply, enabled, sync],
  );

  const undo = useCallback(() => step(stacks.current.past, stacks.current.future), [step]);
  const redo = useCallback(() => step(stacks.current.future, stacks.current.past), [step]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || typing()) return;
      if (useGlobalModalStore.getState().modals.length > 0 || paused) return;
      const letter = event.key.toLowerCase();
      if (letter !== "z" && letter !== "y") return;
      event.preventDefault();
      if (letter === "z" && !event.shiftKey) undo();
      else redo();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [paused, redo, undo]);

  return {
    undo,
    redo,
    rebase,
    canUndo: enabled && depth.past > 0,
    canRedo: enabled && depth.future > 0,
  };
}
