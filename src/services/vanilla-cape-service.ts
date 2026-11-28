import { invoke } from '@tauri-apps/api/core';
import type { VanillaCape } from '../types/vanillaCapes';

export class VanillaCapeService {
  static async getOwnedVanillaCapes(): Promise<VanillaCape[]> {
    return invoke<VanillaCape[]>('get_owned_vanilla_capes');
  }

  static async getCurrentlyEquippedVanillaCape(): Promise<VanillaCape | null> {
    return invoke<VanillaCape | null>('get_currently_equipped_vanilla_cape');
  }

  static async equipVanillaCape(capeId: string | null): Promise<void> {
    return invoke('equip_vanilla_cape', { capeId });
  }
}

export const getOwnedVanillaCapes = VanillaCapeService.getOwnedVanillaCapes;
export const getCurrentlyEquippedVanillaCape = VanillaCapeService.getCurrentlyEquippedVanillaCape;
export const equipVanillaCape = VanillaCapeService.equipVanillaCape;