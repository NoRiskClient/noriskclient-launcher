import { Icon } from "@iconify/react";
import type {
  BugVote,
  ReviewVote,
  TesterIssue,
  TesterStatusTag,
  TesterTypeTag,
  TesterModuleTag,
} from "../../types/tester";
import { VoteControls } from "./VoteControls";

interface TesterIssueCardProps {
  issue: TesterIssue;
  busy: boolean;
  onSubmit: (vote: BugVote | ReviewVote, description?: string) => void;
  onOpenIssue: () => void;
}

function asObj<T extends object>(v: unknown): T | null {
  return v && typeof v === "object" ? (v as T) : null;
}

interface MetaPart {
  text: string;
  color?: string;
}

export function TesterIssueCard({
  issue,
  busy,
  onSubmit,
  onOpenIssue,
}: TesterIssueCardProps) {
  const status = asObj<TesterStatusTag>(issue.header.tags?.status);
  const type = asObj<TesterTypeTag>(issue.header.tags?.type);
  const moduleTag = asObj<TesterModuleTag>(issue.header.tags?.module);
  const number = issue.header.number;
  const isRetest =
    issue.pendingKind === "review" &&
    typeof issue.header.reviewRound === "number" &&
    issue.header.reviewRound > 1;

  const metaParts: MetaPart[] = [];
  if (number !== undefined) metaParts.push({ text: `#${number}` });
  if (status?.name) metaParts.push({ text: status.name, color: status.color });
  if (moduleTag?.name) metaParts.push({ text: moduleTag.name });
  if (type?.name) metaParts.push({ text: type.name });

  return (
    <div className="relative flex flex-col gap-3 p-3 rounded-lg bg-black/20 border border-white/10 hover:border-white/20 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpenIssue}
            title={issue.header.title}
            className="block text-left font-minecraft-ten text-sm text-white normal-case truncate w-full hover:text-white/80 transition-colors"
            style={{ textShadow: "0 2px 4px rgba(0,0,0,0.7)" }}
          >
            {issue.header.title || "(untitled)"}
          </button>
          <div
            className="mt-1 flex items-center gap-1.5 text-xs font-minecraft-ten text-white/50 truncate"
            style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}
          >
            {metaParts.map((p, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-white/25">·</span>}
                <span style={p.color ? { color: p.color } : undefined}>{p.text}</span>
              </span>
            ))}
            {isRetest && (
              <span className="flex items-center gap-1.5">
                <span className="text-white/25">·</span>
                <span className="flex items-center gap-1 text-amber-300/90">
                  <Icon icon="solar:refresh-bold" className="w-3 h-3" />
                  retest #{issue.header.reviewRound}
                </span>
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onOpenIssue}
          className="shrink-0 p-1.5 rounded text-white/40 hover:text-white hover:bg-white/5 transition-colors"
          title="Open on website"
        >
          <Icon icon="solar:square-top-down-linear" className="w-4 h-4" />
        </button>
      </div>

      <VoteControls kind={issue.pendingKind} busy={busy} onSubmit={onSubmit} />
    </div>
  );
}
