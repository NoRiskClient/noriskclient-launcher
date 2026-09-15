const MODAL_BASE = 1000;
const MODAL_MAX_DEPTH = 400;

export const Z_DROPDOWN = 1500;
export const Z_TOOLTIP = 1600;
export const Z_DRAG_OVERLAY = 2000;
export const Z_TOAST = 100000;

export function modalZIndexForDepth(depth: number): number {
  return MODAL_BASE + Math.min(depth, MODAL_MAX_DEPTH);
}
