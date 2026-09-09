import { create } from 'zustand';
import type { ContentType as BackendContentType } from '../types/content';

export type DragHoverKind = 'modpack' | 'content' | 'world' | 'unsupported';

export interface AppDragDropState {
  activeDropProfileId: string | null;
  activeDropContentType: BackendContentType | null;
  activeMainTab: string | null;
  syncPacksDropActive: boolean;
  setSyncPacksDropActive: (active: boolean) => void;
  dragHover: { kind: DragHoverKind; fileNames: string[] } | null;
  setDragHover: (hover: { kind: DragHoverKind; fileNames: string[] } | null) => void;
  setActiveDropContext: (profileId: string | null, contentType: BackendContentType | null) => void;
  setActiveMainTab: (tab: string | null) => void;
  refreshCallbackMap: Map<BackendContentType, () => void>; // Map to store refresh callbacks by content type
  registerRefreshCallback: (contentType: BackendContentType, callback: () => void) => void;
  unregisterRefreshCallback: (contentType: BackendContentType) => void;
  triggerRefresh: (contentType: BackendContentType) => void;
  worldsRefreshCallback: (() => void) | null; // Callback for refreshing worlds list
  registerWorldsRefreshCallback: (callback: () => void) => void;
  unregisterWorldsRefreshCallback: () => void;
  triggerWorldsRefresh: () => void;
}

export const useAppDragDropStore = create<AppDragDropState>((set, get) => ({
  activeDropProfileId: null,
  activeDropContentType: null,
  activeMainTab: null,
  syncPacksDropActive: false,
  setSyncPacksDropActive: (active) => set({ syncPacksDropActive: active }),
  dragHover: null,
  setDragHover: (hover) => {
    const current = get().dragHover;
    if (current === hover) return;
    if (
      current &&
      hover &&
      current.kind === hover.kind &&
      current.fileNames.length === hover.fileNames.length &&
      current.fileNames.every((name, index) => name === hover.fileNames[index])
    ) {
      return;
    }
    set({ dragHover: hover });
  },
  setActiveDropContext: (profileId, contentType) => set({
    activeDropProfileId: profileId, 
    activeDropContentType: contentType 
  }),
  setActiveMainTab: (tab) => set({ activeMainTab: tab }),
  refreshCallbackMap: new Map(),
  registerRefreshCallback: (contentType, callback) => {
    set((state) => ({
      refreshCallbackMap: new Map(state.refreshCallbackMap).set(contentType, callback),
    }));
  },
  unregisterRefreshCallback: (contentType) => {
    set((state) => {
      const newMap = new Map(state.refreshCallbackMap);
      newMap.delete(contentType);
      return { refreshCallbackMap: newMap };
    });
  },
  triggerRefresh: (contentType) => {
    const callback = get().refreshCallbackMap.get(contentType);
    if (callback) {
      callback();
    }
  },
  worldsRefreshCallback: null,
  registerWorldsRefreshCallback: (callback) => {
    set({ worldsRefreshCallback: callback });
  },
  unregisterWorldsRefreshCallback: () => {
    set({ worldsRefreshCallback: null });
  },
  triggerWorldsRefresh: () => {
    const callback = get().worldsRefreshCallback;
    if (callback) {
      callback();
    }
  },
})); 