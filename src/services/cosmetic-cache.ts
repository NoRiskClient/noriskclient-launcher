import { invalidateAsyncResource } from "../hooks/useAsyncResource";

const EQUIPPED_COSMETICS = "equipped-cosmetics";
const SELECTED_ICON = "selected-icon";
const ACTIVE_SKIN = "active-skin";

export function normalizePlayerId(playerId: string): string {
  return playerId.replace(/-/g, "").toLowerCase();
}

export const cosmeticCacheKeys = {
  equippedCosmetics: (playerId: string) => `${EQUIPPED_COSMETICS}:${normalizePlayerId(playerId)}`,
  selectedIcon: (playerId: string) => `${SELECTED_ICON}:${normalizePlayerId(playerId)}`,
  activeSkin: (playerId: string) => `${ACTIVE_SKIN}:${normalizePlayerId(playerId)}`,
};

export function invalidateEquippedCosmetics(): void {
  invalidateAsyncResource(EQUIPPED_COSMETICS);
}

export function invalidateSelectedIcon(): void {
  invalidateAsyncResource(SELECTED_ICON);
}

export function invalidatePlayerAppearance(): void {
  invalidateEquippedCosmetics();
  invalidateSelectedIcon();
}
