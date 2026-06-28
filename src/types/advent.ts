/**
 * Status of an advent calendar day.
 */
export type AdventCalendarDayStatus = "LOCKED" | "AVAILABLE" | "CLAIMED" | "EXPIRED";

/**
 * Type of shop item reward.
 */
export type ShopItemRewardType = "COSMETIC" | "EMOTE";

/**
 * Base interface for all reward types.
 */
interface RewardBase {
  type: string;
}

/**
 * Coin reward.
 */
export interface CoinReward extends RewardBase {
  type: "Coins";
  amount: number;
}

/**
 * Shop item reward with specific item ID.
 */
export interface ShopItemReward extends RewardBase {
  type: "ShopItem";
  shopItemId: string; // UUID
  duration: number | null; // Duration in milliseconds or null
}

/**
 * Random shop item reward.
 */
export interface RandomShopItemReward extends RewardBase {
  type: "RandomShopItem";
  itemType: ShopItemRewardType;
  duration: number | null; // Duration in milliseconds or null
}

/**
 * Discount reward.
 */
export interface DiscountReward extends RewardBase {
  type: "Discount";
  percentage: number;
  endTimestamp: string; // ISO 8601 date string
}

/**
 * NoRisk Plus reward.
 */
export interface NrcPlusReward extends RewardBase {
  type: "NrcPlus";
  duration: number; // Duration in milliseconds
}

/**
 * Theme reward.
 */
export interface ThemeReward extends RewardBase {
  type: "Theme";
  themeId: string;
}

/**
 * Discriminated union of all reward types.
 */
export type Reward =
  | CoinReward
  | ShopItemReward
  | RandomShopItemReward
  | DiscountReward
  | NrcPlusReward
  | ThemeReward;

/**
 * Represents a single day in the advent calendar.
 */
export interface AdventCalendarDay {
  day: number;
  status: AdventCalendarDayStatus;
  reward: Reward | null;
  shopItemName: string | null;
  shopItemModelUrl: string | null;
}

