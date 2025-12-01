import { create } from 'zustand';
import type { ContentType as BackendContentType } from '../types/content';

export interface AppDragDropState {
  activeDropProfileId: string | null;
  activeDropContentType: BackendContentType | null;
  activeMainTab: string | null;
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