import { create } from "zustand";
import * as ProfileService from "../services/profile-service";
import i18n from '../i18n/i18n';

interface ContentState {
  mods: any[];
  resourcePacks: any[];
  shaderPacks: any[];
  customMods: any[];
  loading: {
    mods: boolean;
    resourcePacks: boolean;
    shaderPacks: boolean;
    customMods: boolean;
  };
  error: {
    mods: string | null;
    resourcePacks: string | null;
    shaderPacks: string | null;
    customMods: string | null;
  };

  fetchCustomMods: (profileId: string) => Promise<void>;
  fetchResourcePacks: (profileId: string) => Promise<void>;
  fetchShaderPacks: (profileId: string) => Promise<void>;

  addModrinthMod: (
    profileId: string,
    projectId: string,
    versionId: string,
    fileName: string,
    downloadUrl: string,
    fileHashSha1?: string,
    modName?: string,
    versionNumber?: string,
    loaders?: string[],
    gameVersions?: string[],
  ) => Promise<void>;

  addModrinthContent: (
    profileId: string,
    projectId: string,
    versionId: string,
    fileName: string,
    downloadUrl: string,
    contentType: string,
    fileHashSha1?: string,
    contentName?: string,
    versionNumber?: string,
  ) => Promise<void>;

  setModEnabled: (
    profileId: string,
    modId: string,
    enabled: boolean,
  ) => Promise<void>;
  setCustomModEnabled: (
    profileId: string,
    filename: string,
    enabled: boolean,
  ) => Promise<void>;
  deleteCustomMod: (profileId: string, filename: string) => Promise<void>;
  importLocalMods: (profileId: string) => Promise<void>;
}

export const useContentStore = create<ContentState>((set) => ({
  mods: [],
  resourcePacks: [],
  shaderPacks: [],
  customMods: [],
  loading: {
    mods: false,
    resourcePacks: false,
    shaderPacks: false,
    customMods: false,
  },
  error: {
    mods: null,
    resourcePacks: null,
    shaderPacks: null,
    customMods: null,
  },

  fetchCustomMods: async (profileId: string) => {
    try {
      set((state) => ({
        loading: { ...state.loading, customMods: true },
        error: { ...state.error, customMods: null },
      }));

      const customMods = await ProfileService.getCustomMods(profileId);

      set((state) => ({
        customMods,
        loading: { ...state.loading, customMods: false },
      }));
    } catch (error) {
      console.error(
        `Failed to fetch custom mods for profile ${profileId}:`,
        error,
      );
      set((state) => ({
        loading: { ...state.loading, customMods: false },
        error: { ...state.error, customMods: i18n.t('content.errors.load_custom_mods') },
      }));
    }
  },

  fetchResourcePacks: async (profileId: string) => {
    try {
      set((state) => ({
        loading: { ...state.loading, resourcePacks: true },
        error: { ...state.error, resourcePacks: null },
      }));

      const resourcePacks =
        await ProfileService.getLocalResourcepacks(profileId);

      set((state) => ({
        resourcePacks,
        loading: { ...state.loading, resourcePacks: false },
      }));
    } catch (error) {
      console.error(
        `Failed to fetch resource packs for profile ${profileId}:`,
        error,
      );
      set((state) => ({
        loading: { ...state.loading, resourcePacks: false },
        error: {
          ...state.error,
          resourcePacks: i18n.t('content.errors.load_resource_packs'),
        },
      }));
    }
  },

  fetchShaderPacks: async (profileId: string) => {
    try {
      set((state) => ({
        loading: { ...state.loading, shaderPacks: true },
        error: { ...state.error, shaderPacks: null },
      }));

      const shaderPacks = await ProfileService.getLocalShaderpacks(profileId);

      set((state) => ({
        shaderPacks,
        loading: { ...state.loading, shaderPacks: false },
      }));
    } catch (error) {
      console.error(
        `Failed to fetch shader packs for profile ${profileId}:`,
        error,
      );
      set((state) => ({
        loading: { ...state.loading, shaderPacks: false },
        error: { ...state.error, shaderPacks: i18n.t('content.errors.load_shader_packs') },
      }));
    }
  },

  addModrinthMod: async (
    profileId,
    projectId,
    versionId,
    fileName,
    downloadUrl,
    fileHashSha1,
    modName,
    versionNumber,
    loaders,
    gameVersions,
  ) => {
    try {
      await ProfileService.addModrinthModToProfile(
        profileId,
        projectId,
        versionId,
        fileName,
        downloadUrl,
        fileHashSha1,
        modName,
        versionNumber,
        loaders,
        gameVersions,
      );
    } catch (error) {
      console.error(
        `Failed to add Modrinth mod to profile ${profileId}:`,
        error,
      );
      throw error;
    }
  },

  addModrinthContent: async (
    profileId,
    projectId,
    versionId,
    fileName,
    downloadUrl,
    contentType,
    fileHashSha1,
    contentName,
    versionNumber,
  ) => {
    try {
      await ProfileService.addModrinthContentToProfile(
        profileId,
        projectId,
        versionId,
        fileName,
        downloadUrl,
        fileHashSha1 || undefined || null,
        contentName || fileName,
        versionNumber || undefined || null,
        contentType,
      );

      if (contentType === "resourcepack") {
        await ProfileService.getLocalResourcepacks(profileId);
      } else if (contentType === "shader") {
        await ProfileService.getLocalShaderpacks(profileId);
      }
    } catch (error) {
      console.error(
        `Failed to add Modrinth content to profile ${profileId}:`,
        error,
      );
      throw error;
    }
  },

  setModEnabled: async (profileId, modId, enabled) => {
    try {
      await ProfileService.setProfileModEnabled(profileId, modId, enabled);

      set((state) => ({
        mods: state.mods.map((mod) =>
          mod.id === modId ? { ...mod, enabled } : mod,
        ),
      }));
    } catch (error) {
      console.error(
        `Failed to set mod ${modId} enabled status in profile ${profileId}:`,
        error,
      );
      throw error;
    }
  },

  setCustomModEnabled: async (profileId, filename, enabled) => {
    try {
      await ProfileService.setCustomModEnabled(profileId, filename, enabled);

      set((state) => ({
        customMods: state.customMods.map((mod) =>
          mod.filename === filename ? { ...mod, is_enabled: enabled } : mod,
        ),
      }));
    } catch (error) {
      console.error(
        `Failed to set custom mod ${filename} enabled status in profile ${profileId}:`,
        error,
      );
      throw error;
    }
  },

  deleteCustomMod: async (profileId, filename) => {
    try {
      await ProfileService.deleteCustomMod(profileId, filename);

      set((state) => ({
        customMods: state.customMods.filter((mod) => mod.filename !== filename),
      }));
    } catch (error) {
      console.error(
        `Failed to delete custom mod ${filename} from profile ${profileId}:`,
        error,
      );
      throw error;
    }
  },

  importLocalMods: async (profileId) => {
    try {
      await ProfileService.importLocalMods(profileId);

      const customMods = await ProfileService.getCustomMods(profileId);
      set({ customMods });
    } catch (error) {
      console.error(
        `Failed to import local mods for profile ${profileId}:`,
        error,
      );
      throw error;
    }
  },
}));
