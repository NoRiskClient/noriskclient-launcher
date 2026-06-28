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
  switch (notification.type) {
    // Base notifications
    case TYPES.SIMPLE_TEXT:
      return (notification as SimpleTextNotification).message;
    case TYPES.STRING:
      return (notification as StringNotification).fallback;

    // Friend notifications
    case TYPES.FRIEND_REQUEST_RECEIVED:
      return `${(notification as FriendRequestReceivedNotification).friend.name} sent you a friend request!`;
    case TYPES.FRIEND_REQUEST_ACCEPTED:
      return `${(notification as FriendRequestAcceptedNotification).friend.name} accepted your friend request!`;

    // Shop notifications
    case TYPES.SHOP_GIFT_RECEIVED: {
      const n = notification as ShopGiftReceivedNotification;
      return `${n.grantor.name} gifted you "${n.shopItem.name}"!`;
    }
    case TYPES.SHOP_ITEM_BOUGHT:
      return `You purchased "${(notification as ShopItemBoughtNotification).shopItem.name}"!`;
    case TYPES.SHOP_ITEM_EXPIRING_SOON:
      return `Your item "${(notification as ShopItemExpiringSoonNotification).shopItem.name}" is expiring soon!`;
    case TYPES.SHOP_ITEM_EXPIRED:
      return `Your item "${(notification as ShopItemExpiredNotification).shopItem.name}" has expired.`;

    // McReal notifications
    case TYPES.MCREAL_PUNISHMENT:
      return `You have been punished on McReal: ${(notification as McRealPunishmentNotification).reason}`;
    case TYPES.MCREAL_PUNISHMENT_REVOKED:
      return "Your McReal punishment has been revoked!";
    case TYPES.MCREAL_POST_COMMENTED: {
      const n = notification as McRealPostCommentedNotification;
      const who = n.commenterInfo?.name ?? "Someone";
      const preview = n.commentPreview ? `: "${n.commentPreview}"` : "";
      return `${who} commented on your McReal post${preview}`;
    }
    case TYPES.MCREAL_COMMENT_COMMENTED: {
      const n = notification as McRealCommentCommentedNotification;
      const who = n.commenterInfo?.name ?? "Someone";
      const preview = n.commentPreview ? `: "${n.commentPreview}"` : "";
      return `${who} replied to your comment${preview}`;
    }
    case TYPES.MCREAL_POSTED: {
      const n = notification as McRealPostedNotification;
      const who = n.authorInfo?.name ?? "A friend";
      return `${who} posted on McReal!`;
    }
    case TYPES.MCREAL_MENTIONED_IN_POST: {
      const n = notification as McRealMentionedInPostNotification;
      const who = n.authorInfo?.name ?? "Someone";
      return `${who} mentioned you in a McReal post!`;
    }
    case TYPES.MCREAL_MENTIONED_IN_COMMENT: {
      const n = notification as McRealMentionedInCommentNotification;
      const who = n.authorInfo?.name ?? "Someone";
      const preview = n.commentPreview ? `: "${n.commentPreview}"` : "";
      return `${who} mentioned you in a comment${preview}`;
    }

    // Fallback for unknown notification types
    default:
      return "New notification";
  }
}
