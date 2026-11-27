import { useGlobalModalStore } from "../hooks/useGlobalModal";

export function isEditableTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return target.type !== "range" && target.type !== "checkbox";
  return target instanceof HTMLElement && target.isContentEditable;
}

export function isGlobalModalOpen(): boolean {
  return useGlobalModalStore.getState().modals.length > 0;
}
