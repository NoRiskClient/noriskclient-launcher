export interface AfkPointsBalance {
  afkPoints: number;
  streakDays: number;
  streakFreezes?: number;
  adsRemainingToday?: number | null;
  dailyClaimable?: boolean;
}

export interface DailyClaimState {
  claimable: boolean;
  alreadyClaimed?: boolean;
  adWatchedToday?: boolean;
  streakDays: number;
  bonus: number;
  milestoneBonus: number;
  streakFreezes: number;
}

export interface DailyClaimResult {
  granted: boolean;
  streakDays: number;
  bonus: number;
  milestoneBonus: number;
  balance: number;
  frozenDays: number;
}

export interface AfkShopGrant {
  type: string;
  [key: string]: unknown;
}

export interface AfkShopItemDto {
  id: string;
  name: string;
  description: string;
  icon: string;
  price: number;
  rarity: string;
  category: string;
  grant: AfkShopGrant;
  maxOwned?: number | null;
  badge?: string | null;
  enabled: boolean;
}

export interface AfkShopCatalogDto {
  featured?: AfkShopItemDto | null;
  featuredEndsAt?: number | null;
  items: AfkShopItemDto[];
}

export interface AfkShopCatalogResponse {
  afkPoints: number;
  catalog: AfkShopCatalogDto;
  ownedCounts: Record<string, number>;
}

export interface AfkShopPurchaseResponse {
  itemId: string;
  balance: number;
  granted: string;
}
