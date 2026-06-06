import { useEffect, useState } from "react";

import {
  getEquippedCosmetics,
  type EquippedCosmetics,
} from "../services/cosmetic-equip-service";

export interface EquippedCosmeticsState extends EquippedCosmetics {
  loading: boolean;
  error: Error | null;
}

const EMPTY: EquippedCosmetics = { cosmetics: [], customCapeHash: null };

export function useEquippedCosmetics(
  playerIdentifier: string | null | undefined
): EquippedCosmeticsState {
  const [state, setState] = useState<EquippedCosmeticsState>({
    ...EMPTY,
    loading: !!playerIdentifier,
    error: null,
  });

  useEffect(() => {
    if (!playerIdentifier) {
      setState({ ...EMPTY, loading: false, error: null });
      return;
    }

    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    getEquippedCosmetics(playerIdentifier)
      .then((data) => {
        if (alive) setState({ ...data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ ...EMPTY, loading: false, error });
      });

    return () => {
      alive = false;
    };
  }, [playerIdentifier]);

  return state;
}
