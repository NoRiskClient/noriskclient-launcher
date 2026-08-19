import {
  getSelectedIcon,
  getSelectedIconCached,
  type SelectedIcon,
} from "../services/cosmetic-icon-service";
import { cosmeticCacheKeys } from "../services/cosmetic-cache";
import { useAsyncResource } from "./useAsyncResource";

const EMPTY: SelectedIcon = { url: null, plus: false };

export function useSelectedIcon(
  playerIdentifier: string | null | undefined
): SelectedIcon {
  const { data } = useAsyncResource<SelectedIcon>(
    playerIdentifier ? () => getSelectedIcon(playerIdentifier) : null,
    [playerIdentifier],
    EMPTY,
    playerIdentifier
      ? {
          cacheKey: cosmeticCacheKeys.selectedIcon(playerIdentifier),
          hydrate: () => getSelectedIconCached(playerIdentifier),
        }
      : undefined,
  );

  return data;
}
