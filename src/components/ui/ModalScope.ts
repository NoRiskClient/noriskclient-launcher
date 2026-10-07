import { createContext, useContext } from "react";

// React context crosses portals; DOM containment alone cannot identify them.
export const ModalScopeContext = createContext<string | undefined>(undefined);
export const useModalScope = () => useContext(ModalScopeContext);

/** A body portal must paint above the real owning dialog's ancestor layer. */
export function getModalPortalZIndex(owner: string | undefined, fallback: number): number {
  if (!owner || typeof document === "undefined") return fallback;
  const panel = Array.from(document.querySelectorAll<HTMLElement>("[data-modal-id]"))
    .find(node => node.dataset.modalId === owner);
  let layer = 0;
  for (let node = panel; node; node = node.parentElement ?? undefined) {
    const zIndex = Number.parseInt(getComputedStyle(node).zIndex, 10);
    if (Number.isFinite(zIndex)) layer = Math.max(layer, zIndex);
  }
  return Math.max(fallback, layer + 1);
}
