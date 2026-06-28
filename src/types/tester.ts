export type PendingKind = "bug" | "review";

export interface TesterStatusTag {
  id?: string;
  name?: string;
  color?: string;
  emoji?: string;
  allowBugValidation?: boolean;
  allowReviewVoting?: boolean;
}

export interface TesterTypeTag {
  id?: string;
  name?: string;
  emoji?: string;
}

export interface TesterModuleTag {
  id?: string;
  name?: string;
  emoji?: string;
}

export interface TesterIssueHeader {
  title?: string;
  number?: number;
  slug?: string;
  reviewRound?: number;
  tags?: {
    status?: TesterStatusTag | string;
    type?: TesterTypeTag | string;
    module?: TesterModuleTag | string;
  };
  voteStats?: {
    upvoteCount?: number;
    downvoteCount?: number;
    totalScore?: number;
  };
  bugValidationStats?: {
    validCount?: number;
    invalidCount?: number;
  };
  reviewVoteStats?: {
    worksCount?: number;
    needsChangesCount?: number;
    doesNotWorkCount?: number;
  };
}

export interface TesterIssue {
  id: string;
  pendingKind: PendingKind;
  header: TesterIssueHeader;
  createdAt?: string;
  updatedAt?: string;
}

export interface NeedsTestingResponse {
  docs: TesterIssue[];
  totalDocs: number;
}

export type BugVote = "valid" | "invalid";
export type ReviewVote = "works_perfectly" | "needs_changes" | "does_not_work";

export interface SubmitTestVoteResponse {
  ok: boolean;
  kind: PendingKind;
  doc?: unknown;
  error?: string;
}
