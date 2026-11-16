import i18n from "../i18n/i18n";
/**
 * Base interface for all notification content types.
 */
interface NotificationBase {
  type: string;
  createdAt: string;
}

// === Helper Types ===

/**
 * User displayable info (for friends, grantors, etc.)
 */
export interface NotificationUser {
  uuid: string;
  name: string;
  rank: string;
}

/**
 * Shop item minimal info.
 */
export interface NotificationShopItem {
  id: string;
  name: string;
  rarity: string;
}

// === Base Notifications ===

/**
 * Simple text notification.
 */
export interface SimpleTextNotification extends NotificationBase {
  type: "gg.norisk.networking.model.notifications.notification.SimpleTextNotification";
  message: string;
}

/**
 * String notification with translation support.
 */
export interface StringNotification extends NotificationBase {
  type: "string";
  translationKey: string | null;
  fallback: string;
  args: Record<string, string>;
}

// === Friend Notifications ===

/**
 * Friend request received notification.
 */
export interface FriendRequestReceivedNotification extends NotificationBase {
  type: "gg.norisk.networking.model.notifications.notification.FriendRequestReceivedNotifications";
  friend: NotificationUser;
}

/**
 * Friend request accepted notification.
 */
export interface FriendRequestAcceptedNotification extends NotificationBase {
  type: "gg.norisk.networking.model.notifications.notification.FriendRequestAcceptedNotifications";
  friend: NotificationUser;
}

// === Shop Notifications ===

/**
 * Shop gift received notification.
 */
export interface ShopGiftReceivedNotification extends NotificationBase {
  type: "gg.norisk.networking.model.notifications.notification.ShopGiftReceivedNotification";
  shopItem: NotificationShopItem;
  grantor: NotificationUser;
  expirationDate: string | null;
  anonymous?: boolean;
  message?: string | null;
}

/**
 * Shop item bought notification.
 */
export interface ShopItemBoughtNotification extends NotificationBase {
  type: "gg.norisk.networking.model.notifications.notification.ShopItemBoughtNotification";
  shopItem: NotificationShopItem;
  expirationDate: string | null;
}

/**
 * Shop item expiring soon notification.
 */
export interface ShopItemExpiringSoonNotification extends NotificationBase {
  type: "gg.norisk.networking.model.notifications.notification.ShopItemExpiringSoonNotification";
  shopItem: NotificationShopItem;
  expirationDate: string;
}

/**
 * Shop item expired notification.
 */
export interface ShopItemExpiredNotification extends NotificationBase {
  type: "gg.norisk.networking.model.notifications.notification.ShopItemExpiredNotification";
  shopItem: NotificationShopItem;
}

// === McReal Notifications ===

/**
 * McReal punishment notification.
 */
export interface McRealPunishmentNotification extends NotificationBase {
  type: "gg.norisk.networking.model.notifications.notification.McRealPunishmentNotification";
  duration: string;
  reason: string;
  expirationDate: string | null;
}

/**
 * McReal punishment revoked notification.
 */
export interface McRealPunishmentRevokedNotification extends NotificationBase {
  type: "gg.norisk.networking.model.notifications.notification.McRealPunishmentRevokedNotification";
}

/**
 * McReal post commented notification.
 */
export interface McRealPostCommentedNotification extends NotificationBase {
  type: "gg.norisk.networking.model.notifications.notification.McRealPostCommentedNotification";
  postId: string;
  commentId: string;
  commenter: string;
  commenterInfo?: NotificationUser;
  commentPreview?: string;
}

/**
 * McReal comment commented notification.
 */
export interface McRealCommentCommentedNotification extends NotificationBase {
  type: "gg.norisk.networking.model.notifications.notification.McRealCommentCommentedNotification";
  parentCommentId: string;
  commentId: string;
  commenter: string;
  commenterInfo?: NotificationUser;
  commentPreview?: string;
}

/**
 * McReal posted notification (friend posted).
 */
export interface McRealPostedNotification extends NotificationBase {
  type: "gg.norisk.networking.model.notifications.notification.McRealPostedNotification";
  postId: string;
  author: string;
  authorInfo?: NotificationUser;
}

/**
 * McReal mentioned in post notification.
 */
export interface McRealMentionedInPostNotification extends NotificationBase {
  type: "gg.norisk.networking.model.notifications.notification.McRealMentionedInPostNotification";
  postId: string;
  author: string;
  authorInfo?: NotificationUser;
}

/**
 * McReal mentioned in comment notification.
 */
export interface McRealMentionedInCommentNotification extends NotificationBase {
  type: "gg.norisk.networking.model.notifications.notification.McRealMentionedInCommentNotification";
  commentId: string;
  author: string;
  authorInfo?: NotificationUser;
  commentPreview?: string;
}

// === Type Unions ===

/**
 * Unknown notification type - fallback for new/unhandled notification types.
 */
export interface UnknownNotification {
  type: string;
  createdAt?: string;
  [key: string]: unknown;
}

/**
 * Known notification content types.
 */
export type KnownNotificationContent =
  | SimpleTextNotification
  | StringNotification
  | FriendRequestReceivedNotification
  | FriendRequestAcceptedNotification
  | ShopGiftReceivedNotification
  | ShopItemBoughtNotification
  | ShopItemExpiringSoonNotification
  | ShopItemExpiredNotification
  | McRealPunishmentNotification
  | McRealPunishmentRevokedNotification
  | McRealPostCommentedNotification
  | McRealCommentCommentedNotification
  | McRealPostedNotification
  | McRealMentionedInPostNotification
  | McRealMentionedInCommentNotification;

/**
 * All notification content types including unknown.
 */
export type NotificationContent = KnownNotificationContent | UnknownNotification;

/**
 * User notification wrapper containing the notification content and metadata.
 */
export interface UserNotification {
  _id: string;
  userId: string;
  seen: boolean;
  notification: NotificationContent;
  deletionDate: string | null;
}

// Notification type constants for easier matching
const TYPES = {
  SIMPLE_TEXT: "gg.norisk.networking.model.notifications.notification.SimpleTextNotification",
  STRING: "string",
  FRIEND_REQUEST_RECEIVED: "gg.norisk.networking.model.notifications.notification.FriendRequestReceivedNotifications",
  FRIEND_REQUEST_ACCEPTED: "gg.norisk.networking.model.notifications.notification.FriendRequestAcceptedNotifications",
  SHOP_GIFT_RECEIVED: "gg.norisk.networking.model.notifications.notification.ShopGiftReceivedNotification",
  SHOP_ITEM_BOUGHT: "gg.norisk.networking.model.notifications.notification.ShopItemBoughtNotification",
  SHOP_ITEM_EXPIRING_SOON: "gg.norisk.networking.model.notifications.notification.ShopItemExpiringSoonNotification",
  SHOP_ITEM_EXPIRED: "gg.norisk.networking.model.notifications.notification.ShopItemExpiredNotification",
  MCREAL_PUNISHMENT: "gg.norisk.networking.model.notifications.notification.McRealPunishmentNotification",
  MCREAL_PUNISHMENT_REVOKED: "gg.norisk.networking.model.notifications.notification.McRealPunishmentRevokedNotification",
  MCREAL_POST_COMMENTED: "gg.norisk.networking.model.notifications.notification.McRealPostCommentedNotification",
  MCREAL_COMMENT_COMMENTED: "gg.norisk.networking.model.notifications.notification.McRealCommentCommentedNotification",
  MCREAL_POSTED: "gg.norisk.networking.model.notifications.notification.McRealPostedNotification",
  MCREAL_MENTIONED_IN_POST: "gg.norisk.networking.model.notifications.notification.McRealMentionedInPostNotification",
  MCREAL_MENTIONED_IN_COMMENT: "gg.norisk.networking.model.notifications.notification.McRealMentionedInCommentNotification",
} as const;

/**
 * Helper to get the display message from a notification.
 */
export function getNotificationMessage(notification: NotificationContent): string {
  const someone = i18n.t("notifications.someone");
  switch (notification.type) {
    // Base notifications
    case TYPES.SIMPLE_TEXT:
      return (notification as SimpleTextNotification).message;
    case TYPES.STRING:
      return (notification as StringNotification).fallback;

    // Friend notifications
    case TYPES.FRIEND_REQUEST_RECEIVED:
      return i18n.t("notifications.friend_request_received", { name: (notification as FriendRequestReceivedNotification).friend.name });
    case TYPES.FRIEND_REQUEST_ACCEPTED:
      return i18n.t("notifications.friend_request_accepted", { name: (notification as FriendRequestAcceptedNotification).friend.name });

    // Shop notifications
    case TYPES.SHOP_GIFT_RECEIVED: {
      const n = notification as ShopGiftReceivedNotification;
      const sender = n.anonymous ? someone : n.grantor.name;
      return i18n.t("notifications.shop_gift_received", { sender, item: n.shopItem.name });
    }
    case TYPES.SHOP_ITEM_BOUGHT:
      return i18n.t("notifications.shop_item_bought", { item: (notification as ShopItemBoughtNotification).shopItem.name });
    case TYPES.SHOP_ITEM_EXPIRING_SOON:
      return i18n.t("notifications.shop_item_expiring_soon", { item: (notification as ShopItemExpiringSoonNotification).shopItem.name });
    case TYPES.SHOP_ITEM_EXPIRED:
      return i18n.t("notifications.shop_item_expired", { item: (notification as ShopItemExpiredNotification).shopItem.name });

    // McReal notifications
    case TYPES.MCREAL_PUNISHMENT:
      return i18n.t("notifications.mcreal_punishment", { reason: (notification as McRealPunishmentNotification).reason });
    case TYPES.MCREAL_PUNISHMENT_REVOKED:
      return i18n.t("notifications.mcreal_punishment_revoked");
    case TYPES.MCREAL_POST_COMMENTED: {
      const n = notification as McRealPostCommentedNotification;
      const who = n.commenterInfo?.name ?? someone;
      const preview = n.commentPreview ? `: "${n.commentPreview}"` : "";
      return i18n.t("notifications.mcreal_post_commented", { who, preview });
    }
    case TYPES.MCREAL_COMMENT_COMMENTED: {
      const n = notification as McRealCommentCommentedNotification;
      const who = n.commenterInfo?.name ?? someone;
      const preview = n.commentPreview ? `: "${n.commentPreview}"` : "";
      return i18n.t("notifications.mcreal_comment_commented", { who, preview });
    }
    case TYPES.MCREAL_POSTED: {
      const n = notification as McRealPostedNotification;
      const who = n.authorInfo?.name ?? i18n.t("notifications.a_friend");
      return i18n.t("notifications.mcreal_posted", { who });
    }
    case TYPES.MCREAL_MENTIONED_IN_POST: {
      const n = notification as McRealMentionedInPostNotification;
      const who = n.authorInfo?.name ?? someone;
      return i18n.t("notifications.mcreal_mentioned_in_post", { who });
    }
    case TYPES.MCREAL_MENTIONED_IN_COMMENT: {
      const n = notification as McRealMentionedInCommentNotification;
      const who = n.authorInfo?.name ?? someone;
      const preview = n.commentPreview ? `: "${n.commentPreview}"` : "";
      return i18n.t("notifications.mcreal_mentioned_in_comment", { who, preview });
    }

    // Fallback for unknown notification types
    default:
      return i18n.t("notifications.new_notification");
  }
}

/**
 * The personal note a notification carries, e.g. the message attached to a gift.
 */
export function getNotificationNote(notification: NotificationContent): string | null {
  if (notification.type === TYPES.SHOP_GIFT_RECEIVED) {
    return (notification as ShopGiftReceivedNotification).message ?? null;
  }
  return null;
}
