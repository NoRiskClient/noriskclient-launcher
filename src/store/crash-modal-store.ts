import { create } from 'zustand';
import { MinecraftProcessExitedPayload } from '../types/events';
import { getLocalContent } from '../services/profile-service';
import { ContentType } from '../types/content';

interface CrashModalState {
  isCrashModalOpen: boolean;
  crashData: MinecraftProcessExitedPayload | null;
  openCrashModal: (data: MinecraftProcessExitedPayload) => void;
  closeCrashModal: () => void;
}

const useCrashModalStore = create<CrashModalState>((set) => ({
  isCrashModalOpen: false,
  crashData: null,
  openCrashModal: (data) => {
    const metadata = data.process_metadata;
    void (async () => {
      try {
        const { trackEvent } = await import('../services/analytics-service');
        let localMods: string[] = [];
        let localModsTotal = 0;

        try {
          const folderMods = await getLocalContent({
            profile_id: data.profile_id,
            content_type: ContentType.Mod,
            calculate_hashes: false,
            fetch_modrinth_data: false,
          });
          localModsTotal = folderMods.length;
          localMods = folderMods.map((mod) => mod.filename);
        } catch (modsError) {
          console.error('[Crash Analytics] Failed to load folder mods:', modsError);
        }

        await trackEvent('minecraft_crash', {
          minecraft_version: metadata?.minecraft_version ?? null,
          nrc_pack: metadata?.norisk_pack ?? null,
          local_mods: localMods,
          local_mods_total: localModsTotal,
          modloader: metadata?.modloader ?? null,
          modloader_version: metadata?.modloader_version ?? null,
          memory_max_mb: metadata?.memory_max_mb ?? null,
        });
      } catch (error) {
        console.error('[Crash Analytics] Failed to track crash event:', error);
      }
    })();
    set({ isCrashModalOpen: true, crashData: data });
  },
  closeCrashModal: () => set({ isCrashModalOpen: false, crashData: null }),
}));

export { useCrashModalStore }; 