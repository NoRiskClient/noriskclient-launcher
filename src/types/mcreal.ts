export interface McRealPost {
  _id: string;
  author: string;
  uploadDate: string;
  uploadTime: string;
  mcRealTime: string;
  mcRealDate: string;
  region?: string | null;
  title?: string | null;
  serverIp?: string | null;
  friendsOnly: boolean;
  mediaTypes: Record<string, string>;
  status?: string | null;
  uploadTimestamp: number;
}

export interface McRealRating {
  user: string;
  isPositive: boolean;
}

export interface McRealPostWithRating {
  post: McRealPost;
  likes: number;
  dislikes: number;
  userRating?: McRealRating | null;
}

export interface McRealComment {
  _id: string;
  postId: string;
  author: string;
  text: string;
  time?: string | null;
  parentCommentId?: string | null;
}

export interface McRealCommentWithRating {
  comment: McRealComment;
  replies: number;
  likes: number;
  dislikes: number;
  userRating?: McRealRating | null;
}

export interface McRealCommentsHolder {
  singleTotalComments: number;
  totalComments: number;
  comments: McRealCommentWithRating[];
}

export interface McRealUser {
  _id: string;
  region?: string | null;
  pinnedPosts: (string | null)[];
  totalPostOfTheDays: number;
  streak: unknown;
  postOfTheDayStreak: unknown;
}

export interface McRealUserClient {
  user: McRealUser;
  postsWithRating: McRealPostWithRating[];
  punishment?: unknown | null;
}

export interface McRealProfile {
  nrcUser: unknown;
  pinnedPosts: (McRealPostWithRating | null)[];
  lastPosts: (McRealPostWithRating | null)[];
  firstJoinTimeStamp: number;
  lastJoinTimeStamp: number;
  playTime: number;
  loginStreak: unknown;
  mcRealStreak: unknown;
}

export type McRealSort =
  | "NEWEST"
  | "OLDEST"
  | "MOST_LIKES"
  | "MOST_DISLIKES"
  | "BEST_RATING"
  | "STREAK";

export type McRealImageType = "primary" | "secondary";
