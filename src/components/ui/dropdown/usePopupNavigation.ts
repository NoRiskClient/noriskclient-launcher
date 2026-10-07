import { useLayoutEffect, useRef, type RefObject } from "react";

const openPopups: HTMLElement[] = [];
const itemSelector = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [data-popup-item]';

/** One keyboard contract for action menus and single-choice lists, including portals. */
export function usePopupNavigation(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null> | undefined,
  onClose: () => void,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const trigger = triggerRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const items = () => Array.from(panel.querySelectorAll<HTMLElement>(itemSelector))
      .filter(item => !item.matches(':disabled, [aria-disabled="true"]') &&
        !item.closest('[inert], [hidden]') && item.getClientRects().length > 0);
    const focusItem = (item?: HTMLElement) => {
      if (!item) return;
      for (const candidate of items()) candidate.tabIndex = candidate === item ? 0 : -1;
      item.focus({ preventScroll: true });
      item.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    openPopups.push(panel);
    let ownedFocus = false;
    const recoverFocus = () => {
      if (openPopups.at(-1) !== panel || !panel.isConnected) return;
      const active = document.activeElement;
      if (panel.contains(active) && active !== panel) { ownedFocus = true; return; }
      // Pending menus initially have no items. When real async content arrives,
      // focus it only while the popup still owns focus; never pull it back from
      // an unrelated control that the user deliberately reached.
      if (active !== panel && active !== trigger && !(ownedFocus && active === document.body)) return;
      const candidates = items();
      const next = candidates.find(item => item.matches('[aria-selected="true"], [aria-checked="true"], [data-selected="true"]')) ?? candidates[0];
      if (next) focusItem(next);
      else { panel.tabIndex = -1; panel.focus({ preventScroll: true }); }
      ownedFocus = true;
    };
    const input = panel.querySelector<HTMLInputElement>('input:not(:disabled), textarea:not(:disabled)');
    if (!panel.contains(document.activeElement)) {
      if (input) { input.focus({ preventScroll: true }); ownedFocus = true; }
      else recoverFocus();
    } else ownedFocus = true;
    const observer = new MutationObserver(recoverFocus);
    observer.observe(panel, { childList: true, subtree: true });
    let search = "", lastSearch = 0;
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || openPopups.at(-1) !== panel || !panel.isConnected) return;
      const active = document.activeElement;
      if (!panel.contains(active) && active !== trigger) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); close.current();
        if (trigger?.isConnected && !trigger.closest('[inert]')) trigger.focus({ preventScroll: true });
        return;
      }
      if (event.key === "Tab") {
        // Resume the normal document/dialog tab order at the trigger, not at the body portal.
        close.current();
        if (trigger?.isConnected && !trigger.closest('[inert]')) trigger.focus({ preventScroll: true });
        return;
      }
      const editing = active instanceof HTMLElement && active.matches('input, textarea, [contenteditable="true"]');
      const candidates = items();
      if (!candidates.length) return;
      const index = candidates.indexOf(active as HTMLElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = index < 0 ? (event.key === "ArrowDown" ? 0 : candidates.length - 1) :
          (index + (event.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length;
        focusItem(candidates[next]);
      } else if (!editing && (event.key === "Home" || event.key === "End")) {
        event.preventDefault(); focusItem(candidates[event.key === "Home" ? 0 : candidates.length - 1]);
      } else if (!editing && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
        const now = Date.now(); search = now - lastSearch > 700 ? event.key : search + event.key; lastSearch = now;
        const term = search.toLocaleLowerCase();
        const ordered = [...candidates.slice(index + 1), ...candidates.slice(0, index + 1)];
        const match = ordered.find(item => item.textContent?.trim().toLocaleLowerCase().startsWith(term));
        if (match) { event.preventDefault(); focusItem(match); }
      }
    };
    const outside = (event: MouseEvent) => {
      if (openPopups.at(-1) === panel && !panel.contains(event.target as Node) && !trigger?.contains(event.target as Node)) close.current();
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", outside);
    return () => {
      openPopups.splice(openPopups.indexOf(panel), 1);
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", outside);
      observer.disconnect();
      if (panel.contains(document.activeElement) && trigger?.isConnected && !trigger.closest('[inert]')) trigger.focus({ preventScroll: true });
    };
  }, [open, panelRef, triggerRef]);
}
