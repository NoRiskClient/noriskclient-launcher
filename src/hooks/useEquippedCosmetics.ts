import {
  getEquippedCosmetics,
  type EquippedCosmetics,
} from "../services/cosmetic-equip-service";
import { useAsyncResource } from "./useAsyncResource";

export interface EquippedCosmeticsState extends EquippedCosmetics {
  loading: boolean;
  error: Error | null;
}

const EMPTY: EquippedCosmetics = { cosmetics: [], customCapeHash: null };

export function useEquippedCosmetics(
  playerIdentifier: string | null | undefined
): EquippedCosmeticsState {
  const { data, loading, error } = useAsyncResource<EquippedCosmetics>(
    playerIdentifier ? () => getEquippedCosmetics(playerIdentifier) : null,
    [playerIdentifier],
    EMPTY,
  );

  return { ...data, loading, error };
}
