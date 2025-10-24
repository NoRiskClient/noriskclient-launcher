import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface HiddenProfilesState {
  hiddenProfileIds: string[];
  showHiddenProfiles: boolean;
  hideProfile: (profileId: string) => void;
  showProfile: (profileId: string) => void;
  isProfileHidden: (profileId: string) => boolean;
  clearHiddenProfiles: () => void;
  toggleShowHiddenProfiles: () => void;
}

export const useHiddenProfilesStore = create<HiddenProfilesState>()(
  persist(
    (set, get) => ({
      hiddenProfileIds: [],
      showHiddenProfiles: false,
      
      hideProfile: (profileId: string) => {
        set((state) => ({
          hiddenProfileIds: [...state.hiddenProfileIds, profileId],
        }));
      },
      
      showProfile: (profileId: string) => {
        set((state) => ({
          hiddenProfileIds: state.hiddenProfileIds.filter(id => id !== profileId),
        }));
      },
      
      isProfileHidden: (profileId: string) => {
        const { hiddenProfileIds } = get();
        return hiddenProfileIds.includes(profileId);
      },
      
      clearHiddenProfiles: () => {
        set({ hiddenProfileIds: [] });
      },
      
      toggleShowHiddenProfiles: () => {
        set((state) => ({
          showHiddenProfiles: !state.showHiddenProfiles,
        }));
      },
    }),
    {
      name: 'hidden-profiles-storage',
    },
  ),
);
