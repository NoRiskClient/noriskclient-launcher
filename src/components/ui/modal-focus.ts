interface DialogLayer {
  panel: HTMLElement;
  id: string;
  returnFocus: HTMLElement | null;
  canEscape: () => boolean;
  close: () => void;
}

const layers: DialogLayer[] = [];
const initializedLayers = new WeakSet<DialogLayer>();
const previousInert = new Map<HTMLElement, boolean>();
let observer: MutationObserver | undefined;
let recoveryFrame: number | undefined;
let rootReturnFocus: HTMLElement | null = null;
const layerSubscribers = new Set<() => void>();
let feedbackHosts = 0;
const selector = 'button, input, select, textarea, a[href], [tabindex], [contenteditable="true"]';

/** Feedback follows the same topmost layer as keyboard and portal ownership. */
export function subscribeDialogLayer(listener: () => void) {
  layerSubscribers.add(listener);
  return () => { layerSubscribers.delete(listener); };
}

export function getTopDialogId() {
  return topLayer()?.id ?? null;
}

/** Reserve a steady feedback lane before any dialog or asynchronous toast opens. */
export function registerModalFeedbackHost() {
  feedbackHosts++;
  document.documentElement.dataset.nrcFeedbackHost = "true";
  return () => {
    feedbackHosts = Math.max(0, feedbackHosts - 1);
    if (!feedbackHosts) delete document.documentElement.dataset.nrcFeedbackHost;
  };
}

function priority(layer: DialogLayer) {
  let result = 0;
  for (let node: HTMLElement | null = layer.panel; node; node = node.parentElement) {
    const value = Number.parseInt(getComputedStyle(node).zIndex, 10);
    if (Number.isFinite(value)) result = Math.max(result, value);
  }
  return result;
}

function topLayer() {
  return layers.filter(layer => layer.panel.isConnected).reduce<DialogLayer | undefined>((top, layer) => {
    if (!top || top.panel.contains(layer.panel)) return layer;
    if (layer.panel.contains(top.panel)) return top;
    return priority(layer) >= priority(top) ? layer : top;
  }, undefined);
}

export function isTopDialog(panel: HTMLElement | null) {
  return topLayer()?.panel === panel;
}

function scopes(layer: DialogLayer) {
  return [layer.panel, ...Array.from(document.querySelectorAll<HTMLElement>("[data-modal-owner]"))
    .filter(node => node.dataset.modalOwner === layer.id)];
}

function belongsTo(layer: DialogLayer, target: EventTarget | null) {
  return target instanceof Node && scopes(layer).some(scope => scope.contains(target));
}

function focusable(layer: DialogLayer) {
  return scopes(layer).flatMap(scope => [
    ...(scope.matches(selector) ? [scope] : []),
    ...Array.from(scope.querySelectorAll<HTMLElement>(selector)),
  ])
    .filter((node, index, all) => all.indexOf(node) === index && node.tabIndex >= 0 &&
      !node.matches(':disabled, [aria-disabled="true"]') && !node.closest('[inert], [hidden], [aria-hidden="true"]') &&
      node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden")
    // Owned portals can precede the panel in the DOM. Native Tab follows DOM
    // order, so only a DOM-ordered boundary can wrap without escaping the app.
    .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
}

function focusInside(layer: DialogLayer) {
  const autofocus = layer.panel.querySelector<HTMLElement>("[autofocus]");
  const items = focusable(layer);
  (autofocus ?? items.find(node => layer.panel.contains(node)) ?? items[0] ?? layer.panel).focus({ preventScroll: true });
}

function restoreInert() {
  previousInert.forEach((inert, node) => { node.inert = inert; });
  previousInert.clear();
}

function updateExposure() {
  restoreInert();
  const top = topLayer();
  layers.forEach(layer => {
    layer.panel.setAttribute("aria-modal", String(layer === top));
    layer.panel.dataset.modalTopmost = String(layer === top);
  });
  layerSubscribers.forEach(listener => listener());
  if (!top) return;
  const allowed = [...scopes(top), ...Array.from(document.querySelectorAll<HTMLElement>("[data-modal-live-region]"))];
  const visit = (node: HTMLElement) => {
    if (allowed.some(scope => scope === node || scope.contains(node))) return;
    if (allowed.some(scope => node.contains(scope))) {
      Array.from(node.children).forEach(child => { if (child instanceof HTMLElement) visit(child); });
    } else if (!node.matches("script, style, link")) {
      previousInert.set(node, node.inert);
      node.inert = true;
    }
  };
  Array.from(document.body.children).forEach(child => { if (child instanceof HTMLElement) visit(child); });
}

function onFocus(event: FocusEvent) {
  const top = topLayer();
  if (top && !belongsTo(top, event.target)) focusInside(top);
}

function queueLostFocusRecovery() {
  const top = topLayer();
  if (!top || !initializedLayers.has(top) || recoveryFrame !== undefined) return;
  // Native blur may precede the incoming Tab target or leave BODY after a
  // vetoed backdrop click. Share one deferred recheck with content recovery.
  recoveryFrame = requestAnimationFrame(() => {
    recoveryFrame = undefined;
    const currentTop = topLayer();
    const current = document.activeElement;
    if (currentTop && initializedLayers.has(currentTop) &&
      (!current || current === document.body || current === document.documentElement || !current.isConnected)) {
      currentTop.panel.focus({ preventScroll: true });
    }
  });
}

function onFocusOut(event: FocusEvent) {
  const top = topLayer();
  if (top && initializedLayers.has(top) && belongsTo(top, event.target)) queueLostFocusRecovery();
}

function onContentChanged() {
  updateExposure();
  const active = document.activeElement;
  // Removed loading/result rows do not necessarily emit focusout. Connected
  // native actions and owned portals retain priority at the deferred recheck.
  if (!active || active === document.body || active === document.documentElement || !active.isConnected) {
    queueLostFocusRecovery();
  }
}

function onKey(event: KeyboardEvent) {
  const top = topLayer();
  if (!top || event.defaultPrevented || event.isComposing) return;
  if (event.key === "Escape") {
    // Even a mandatory dialog must not let Escape reach a background layer.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (top.canEscape()) top.close();
  } else if (event.key === "Tab") {
    const items = focusable(top);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (!items.length || index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
      event.preventDefault();
      (event.shiftKey ? items.at(-1) : items[0])?.focus({ preventScroll: true });
      if (!items.length) top.panel.focus({ preventScroll: true });
    }
  }
}

export function registerDialog(layer: DialogLayer) {
  if (!layers.length) rootReturnFocus = layer.returnFocus;
  layers.push(layer);
  if (layers.length === 1) {
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onFocusOut);
    // Bubble after local/React menu handlers; consumed Escape closes only the menu.
    window.addEventListener("keydown", onKey);
    observer = new MutationObserver(onContentChanged);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  updateExposure();
  const frame = requestAnimationFrame(() => {
    if (topLayer() === layer && !belongsTo(layer, document.activeElement)) focusInside(layer);
    initializedLayers.add(layer);
  });
  return () => {
    cancelAnimationFrame(frame);
    initializedLayers.delete(layer);
    // Passive cleanup runs after React has removed the panel from the DOM.
    const wasTop = layer.panel.dataset.modalTopmost === "true";
    const index = layers.indexOf(layer);
    if (index >= 0) layers.splice(index, 1);
    updateExposure();
    if (!layers.length) {
      if (recoveryFrame !== undefined) cancelAnimationFrame(recoveryFrame);
      recoveryFrame = undefined;
      observer?.disconnect();
      observer = undefined;
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("keydown", onKey);
    }
    if (wasTop || !topLayer()) {
      const next = topLayer();
      const target = layer.returnFocus?.isConnected ? layer.returnFocus : !layers.length ? rootReturnFocus : null;
      if (target?.isConnected && !target.closest("[inert]")) {
        target.focus({ preventScroll: true });
      } else if (next) focusInside(next);
    }
    if (!layers.length) rootReturnFocus = null;
  };
}
