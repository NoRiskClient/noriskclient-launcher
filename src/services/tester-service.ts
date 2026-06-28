import { invoke } from "@tauri-apps/api/core";
import type {
  BugVote,
  NeedsTestingResponse,
  PendingKind,
  ReviewVote,
  SubmitTestVoteResponse,
} from "../types/tester";

export const fetchTesterQueueCount = (): Promise<{ count: number }> =>
  invoke("fetch_tester_queue_count");

export const fetchTesterQueue = (): Promise<NeedsTestingResponse> =>
  invoke("fetch_tester_queue");

export const openTesterWindow = (): Promise<void> => invoke("open_tester_window");

export interface SubmitTesterVoteArgs {
  issueId: string;
  kind: PendingKind;
  vote: BugVote | ReviewVote;
  description?: string;
}

export const submitTesterVote = (
  args: SubmitTesterVoteArgs,
): Promise<SubmitTestVoteResponse> =>
  invoke("submit_tester_vote", {
    issueId: args.issueId,
    kind: args.kind,
    vote: args.vote,
    description: args.description ?? null,
  });
