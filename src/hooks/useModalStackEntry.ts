import { useEffect, useRef, useState } from "react";
import { modalZIndexForDepth } from "../lib/z-layers";
import { needsRootBlurFallback } from "../lib/platform";

const ROOT_BLUR_CLASS = "modal-background-blur";

const openModalIds = new Set<number>();
let nextModalId = 0;

function syncRootBlur(): void {
  if (!needsRootBlurFallback()) return;
  document
    .getElementById("root")
    ?.classList.toggle(ROOT_BLUR_CLASS, openModalIds.size > 0);
}

function enterModalStack(id: number): number {
  openModalIds.add(id);
  syncRootBlur();
  return modalZIndexForDepth(openModalIds.size);
}

function leaveModalStack(id: number): void {
  openModalIds.delete(id);
  syncRootBlur();
}

export function useModalStackEntry(): number {
  const idRef = useRef<number>();
  if (idRef.current === undefined) {
    idRef.current = ++nextModalId;
  }
  const id = idRef.current;

  const [zIndex] = useState(() => enterModalStack(id));

  useEffect(() => {
    enterModalStack(id);
    return () => leaveModalStack(id);
  }, [id]);

  return zIndex;
}
