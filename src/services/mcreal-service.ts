import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type {
  McRealCommentsHolder,
  McRealCommentWithRating,
  McRealImageType,
  McRealPostWithRating,
  McRealProfile,
  McRealRating,
  McRealSort,
  McRealUserClient,
} from "../types/mcreal";

export const getMcRealFeed = (
  friendsOnly: boolean,
  page: number,
  sort: McRealSort = "NEWEST",
  partnersOnly = false,
): Promise<McRealPostWithRating[]> =>
  invoke("get_mcreal_feed", { friendsOnly, partnersOnly, page, sort });

export const getMcRealTodayPost = (): Promise<McRealPostWithRating | null> =>
  invoke("get_mcreal_today_post");

export const getMcRealPost = (postId: string): Promise<McRealPostWithRating> =>
  invoke("get_mcreal_post", { postId });

export const deleteMcRealPost = (
  postId: string,
): Promise<McRealPostWithRating[]> => invoke("delete_mcreal_post", { postId });

export interface McRealImage {
  /** Webview-usable asset URL. */
  url: string;
  /** True when the server sent the blurred variant (viewer hasn't posted today). */
  blurred: boolean;
}

/** Downloads (cached) post media and returns a webview-usable asset URL. */
export const getMcRealPostImage = async (
  postId: string,
  imageType: McRealImageType,
): Promise<McRealImage> => {
  const result = await invoke<{ path: string; blurred: boolean }>(
    "get_mcreal_post_image",
    { postId, imageType },
  );
  return { url: convertFileSrc(result.path), blurred: result.blurred };
};

export const rateMcRealPost = (
  postId: string,
  isPositive: boolean,
): Promise<McRealRating> => invoke("rate_mcreal_post", { postId, isPositive });

export const unrateMcRealPost = (postId: string): Promise<void> =>
  invoke("unrate_mcreal_post", { postId });

export const getMcRealComments = (
  postId: string,
  page = 0,
  parentCommentId?: string,
): Promise<McRealCommentsHolder> =>
  invoke("get_mcreal_comments", { postId, page, parentCommentId });

export const addMcRealComment = (
  postId: string,
  text: string,
  parentCommentId?: string,
): Promise<McRealCommentWithRating> =>
  invoke("add_mcreal_comment", { postId, text, parentCommentId });

export const deleteMcRealComment = (commentId: string): Promise<void> =>
  invoke("delete_mcreal_comment", { commentId });

export const rateMcRealComment = (
  commentId: string,
  isPositive: boolean,
): Promise<McRealRating> =>
  invoke("rate_mcreal_comment", { commentId, isPositive });

export const unrateMcRealComment = (commentId: string): Promise<void> =>
  invoke("unrate_mcreal_comment", { commentId });

export const getMcRealUser = (
  zoneId?: string,
): Promise<McRealUserClient> => invoke("get_mcreal_user", { zoneId });

export const getMcRealProfile = (userUuid: string): Promise<McRealProfile> =>
  invoke("get_mcreal_profile", { userUuid });

export const followMcRealUser = (userUuid: string): Promise<void> =>
  invoke("follow_mcreal_user", { userUuid });

export const unfollowMcRealUser = (userUuid: string): Promise<void> =>
  invoke("unfollow_mcreal_user", { userUuid });

export const uploadMcRealPost = (
  primaryPath: string,
  secondaryPath: string,
  options?: { title?: string; friendsOnly?: boolean; serverIp?: string },
): Promise<McRealPostWithRating[]> =>
  invoke("upload_mcreal_post", {
    primaryPath,
    secondaryPath,
    title: options?.title,
    friendsOnly: options?.friendsOnly,
    serverIp: options?.serverIp,
  });
