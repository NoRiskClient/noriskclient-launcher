import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SkinFolder {
  id: string;
  name: string;
  created_at: string;
  skin_ids: string[];
}

interface SkinFoldersState {
  folders: SkinFolder[];
  addFolder: (name: string) => void;
  deleteFolder: (folderId: string) => void;
  renameFolder: (folderId: string, newName: string) => void;
  addSkinToFolder: (folderId: string, skinId: string) => void;
  removeSkinFromFolder: (folderId: string, skinId: string) => void;
}

export const useSkinFoldersStore = create<SkinFoldersState>()(
  persist(
    (set, get) => ({
      folders: [],
      
      addFolder: (name: string) => {
        const newFolder: SkinFolder = {
          id: `folder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: name.trim(),
          created_at: new Date().toISOString(),
          skin_ids: [],
        };
        
        set((state) => ({
          folders: [...state.folders, newFolder],
        }));
      },
      
      deleteFolder: (folderId: string) => {
        set((state) => ({
          folders: state.folders.filter(folder => folder.id !== folderId),
        }));
      },
      
      renameFolder: (folderId: string, newName: string) => {
        set((state) => ({
          folders: state.folders.map(folder =>
            folder.id === folderId
              ? { ...folder, name: newName.trim() }
              : folder
          ),
        }));
      },
      
      addSkinToFolder: (folderId: string, skinId: string) => {
        set((state) => ({
          folders: state.folders.map(folder =>
            folder.id === folderId
              ? { 
                  ...folder, 
                  skin_ids: folder.skin_ids.includes(skinId) 
                    ? folder.skin_ids 
                    : [...folder.skin_ids, skinId]
                }
              : folder
          ),
        }));
      },
      
      removeSkinFromFolder: (folderId: string, skinId: string) => {
        set((state) => ({
          folders: state.folders.map(folder =>
            folder.id === folderId
              ? { 
                  ...folder, 
                  skin_ids: folder.skin_ids.filter(id => id !== skinId)
                }
              : folder
          ),
        }));
      },
    }),
    {
      name: 'skin-folders-storage',
    }
  )
);
