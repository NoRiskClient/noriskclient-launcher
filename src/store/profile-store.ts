import { create } from "zustand";
import type {
  CreateProfileParams,
  Profile,
  UpdateProfileParams,
  AllProfilesAndLastPlayed,
} from "../types/profile";
import * as ProfileService from "../services/profile-service";
import type { FileNode } from "../types/fileSystem";
import i18n from '../i18n/i18n';

interface ProfileState {
  profiles: Profile[];
  standardProfiles: Profile[];
  loading: boolean;
  error: string | null;
  selectedProfile: Profile | null;
  lastPlayedProfileId: string | null;
  importingPaths: Set<string>;

  fetchProfiles: () => Promise<void>;
  getProfile: (id: string) => Promise<Profile>;
  createProfile: (params: CreateProfileParams) => Promise<string>;
  updateProfile: (id: string, updates: UpdateProfileParams) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  launchProfile: (id: string) => Promise<void>;
  installProfile: (id: string) => Promise<void>;
  abortProfileLaunch: (id: string) => Promise<void>;
  isProfileLaunching: (id: string) => Promise<boolean>;
  copyProfile: (
    sourceId: string,
    newName: string,
    includeFiles?: string[],
    includeAll?: boolean,
  ) => Promise<string>;
  exportProfile: (
    profileId: string,
    fileName: string,
    includeFiles?: string[],
    openFolder?: boolean,
  ) => Promise<string>;
  setSelectedProfile: (profile: Profile | null) => void;
  refreshSingleProfileInStore: (profileData: Profile) => void;
  addImportingPath: (path: string) => void;
  removeImportingPath: (path: string) => void;
  isPathImporting: (path: string) => boolean;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  standardProfiles: [],
  loading: true,
  error: null,
  selectedProfile: null,
  lastPlayedProfileId: null,
  importingPaths: new Set<string>(),

  fetchProfiles: async () => {
    try {
      set({ error: null });
      const response = await ProfileService.getAllProfilesAndLastPlayed();
      const { all_profiles, last_played_profile_id } = response;

      let newlySelectedProfile: Profile | null = null;
      if (last_played_profile_id) {
        newlySelectedProfile =
          all_profiles.find((p) => p.id === last_played_profile_id) || null;
      }

      set({
        profiles: all_profiles,
        lastPlayedProfileId: last_played_profile_id,
        selectedProfile: newlySelectedProfile,
        loading: false,
      });
    } catch (error) {
      console.error("Failed to fetch all profiles and last played:", error);
      set({ error: i18n.t('profiles.errors.load_failed'), loading: false });
    }
  },

  getProfile: async (id: string) => {
    try {
      const profile = await ProfileService.getProfile(id);
      const { profiles } = get();
      const updatedProfiles = profiles.map((p) => (p.id === id ? profile : p));
      set({ profiles: updatedProfiles });
      return profile;
    } catch (error) {
      console.error(`Failed to get profile ${id}:`, error);
      throw error;
    }
  },

  createProfile: async (params: CreateProfileParams) => {
    try {
      const id = await ProfileService.createProfile(params);
      await get().fetchProfiles();
      return id;
    } catch (error) {
      console.error("Failed to create profile:", error);
      throw error;
    }
  },

  updateProfile: async (id: string, updates: UpdateProfileParams) => {
    try {
      await ProfileService.updateProfile(id, updates);
      const { profiles } = get();
      const updatedProfiles = profiles.map((profile) =>
        profile.id === id ? { ...profile, ...updates } : profile,
      );
      //@ts-ignore
      set({ profiles: updatedProfiles });

      const { selectedProfile } = get();
      if (selectedProfile && selectedProfile.id === id) {
        //@ts-ignore
        set({ selectedProfile: { ...selectedProfile, ...updates } });
      }
    } catch (error) {
      console.error(`Failed to update profile ${id}:`, error);
      throw error;
    }
  },

  deleteProfile: async (id: string) => {
    try {
      await ProfileService.deleteProfile(id);
      set((state) => ({
        profiles: state.profiles.filter((profile) => profile.id !== id),
      }));

      const { selectedProfile } = get();
      if (selectedProfile && selectedProfile.id === id) {
        set({ selectedProfile: null });
      }
    } catch (error) {
      console.error(`Failed to delete profile ${id}:`, error);
      throw error;
    }
  },

  launchProfile: async (id: string) => {
    try {
      await ProfileService.launchProfile(id);
    } catch (error) {
      console.error(`Failed to launch profile ${id}:`, error);
      throw error;
    }
  },

  installProfile: async (id: string) => {
    try {
      //@ts-ignore
      await ProfileService.installProfile(id);
    } catch (error) {
      console.error(`Failed to install profile ${id}:`, error);
      throw error;
    }
  },

  abortProfileLaunch: async (id: string) => {
    try {
      await ProfileService.abortProfileLaunch(id);
    } catch (error) {
      console.error(`Failed to abort profile launch ${id}:`, error);
      throw error;
    }
  },

  isProfileLaunching: async (id: string) => {
    try {
      return await ProfileService.isProfileLaunching(id);
    } catch (error) {
      console.error(`Failed to check if profile ${id} is launching:`, error);
      return false;
    }
  },

  copyProfile: async (
    sourceId: string,
    newName: string,
    includeFiles?: string[],
    includeAll?: boolean,
  ) => {
    try {
      let filesToInclude = includeFiles;
      if (includeAll) {
        const profileDirectoryStructure = await ProfileService.getProfileDirectoryStructure(sourceId);
        // Helper function to recursively get all file paths
        const getAllFilePaths = (node: FileNode): string[] => {
          let paths: string[] = [];
          if (node.children && node.children.length > 0) {
            for (const child of node.children) {
              paths = paths.concat(getAllFilePaths(child));
            }
          } else if (!node.is_dir) {
            // 'path' attribute holds the relative path of the file from the profile root
            if (node.path) {
              paths.push(node.path);
            }
          }
          return paths;
        };
        filesToInclude = getAllFilePaths(profileDirectoryStructure);
      }

      console.log('[ProfileStore] Copying profile with filesToInclude:', filesToInclude);

      const params = {
        source_profile_id: sourceId,
        new_profile_name: newName,
        include_files: filesToInclude,
      };
      const newProfileId = await ProfileService.copyProfile(params);
      let sourceProfile = await get().getProfile(sourceId);
      if (sourceProfile.is_standard_version) {
        await ProfileService.updateProfile(newProfileId, {
          group: "CUSTOM",
        });
      }
      await get().fetchProfiles();
      return newProfileId;
    } catch (error) {
      console.error(`Failed to copy profile ${sourceId}:`, error);
      throw error;
    }
  },

  exportProfile: async (
    profileId: string,
    fileName: string,
    includeFiles?: string[],
    openFolder = true,
  ) => {
    try {
      const params = {
        profile_id: profileId,
        file_name: fileName,
        include_files: includeFiles,
        open_folder: openFolder,
      };
      return await ProfileService.exportProfile(params);
    } catch (error) {
      console.error(`Failed to export profile ${profileId}:`, error);
      throw error;
    }
  },

  setSelectedProfile: (profile: Profile | null) => {
    set({ selectedProfile: profile });
  },

  refreshSingleProfileInStore: (profileData: Profile) => {
    set((state) => {
      const updatedProfiles = state.profiles.map((p) =>
        p.id === profileData.id ? profileData : p,
      );
      let updatedSelectedProfile = state.selectedProfile;
      if (state.selectedProfile && state.selectedProfile.id === profileData.id) {
        updatedSelectedProfile = profileData;
      }
      return {
        profiles: updatedProfiles,
        selectedProfile: updatedSelectedProfile,
      };
    });
  },

  addImportingPath: (path: string) => {
    set((state) => ({
      importingPaths: new Set(state.importingPaths).add(path),
    }));
  },

  removeImportingPath: (path: string) => {
    set((state) => {
      const newSet = new Set(state.importingPaths);
      newSet.delete(path);
      return { importingPaths: newSet };
    });
  },

  isPathImporting: (path: string) => {
    return get().importingPaths.has(path);
  },
}));
