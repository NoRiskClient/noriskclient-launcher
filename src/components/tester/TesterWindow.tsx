import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useThemeStore } from "../../store/useThemeStore";
import { GroupTabs, type GroupTab } from "../ui/GroupTabs";
import { TesterWindowTitlebar } from "./TesterWindowTitlebar";
import { TesterIssueCard } from "./TesterIssueCard";
import {
  fetchTesterQueue,
  submitTesterVote,
} from "../../services/tester-service";
import { openExternalUrl } from "../../services/tauri-service";
import type {
  BugVote,
  ReviewVote,
  TesterIssue,
} from "../../types/tester";
import { parseErrorMessage } from "../../utils/error-utils";

const WEBSITE_BASE = "https://norisk.gg";

function buildIssueUrl(issue: TesterIssue): string {
  const slug = issue.header.slug || issue.header.number || issue.id;
  return `${WEBSITE_BASE}/issues/${slug}`;
}

function complementaryBackground(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  const rgb = m
    ? {
        r: Number.parseInt(m[1], 16),
        g: Number.parseInt(m[2], 16),
        b: Number.parseInt(m[3], 16),
      }
    : { r: 34, g: 34, b: 34 };
  const r = Math.min(Math.floor(rgb.r * 0.1), 30);
  const g = Math.min(Math.floor(rgb.g * 0.1), 30);
  const b = Math.min(Math.floor(rgb.b * 0.1), 30);
  return `rgb(${r}, ${g}, ${b})`;
}

function BorderGlow({ color }: { color: string }) {
  return (
    <>
      <div
        className="absolute top-0 left-0 right-0 h-[2px] pointer-events-none"
        style={{
          background: `linear-gradient(to right, transparent, ${color}70, transparent)`,
        }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 h-[2px] pointer-events-none"
        style={{
          background: `linear-gradient(to right, transparent, ${color}70, transparent)`,
        }}
      />
      <div
        className="absolute top-0 bottom-0 left-0 w-[2px] pointer-events-none"
        style={{
          background: `linear-gradient(to bottom, transparent, ${color}70, transparent)`,
        }}
      />
      <div
        className="absolute top-0 bottom-0 right-0 w-[2px] pointer-events-none"
        style={{
          background: `linear-gradient(to bottom, transparent, ${color}70, transparent)`,
        }}
      />
    </>
  );
}

export function TesterWindow() {
  const accentColor = useThemeStore((state) => state.accentColor);
  const [issues, setIssues] = useState<TesterIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIssueId, setBusyIssueId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"bug" | "review">("review");
  const closeOnEmptyRef = useRef(false);
  const bgColor = complementaryBackground(accentColor.value);

  useEffect(() => {
    const themeStore = useThemeStore.getState();
    themeStore.applyAccentColorToDOM();
    themeStore.applyBorderRadiusToDOM();
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetchTesterQueue();
      setIssues(resp.docs);
    } catch (err) {
      console.error("[TesterWindow] failed to fetch queue:", err);
      toast.error("Failed to load tester queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (issues.length > 0) {
      closeOnEmptyRef.current = true;
      return;
    }
    if (!loading && closeOnEmptyRef.current) {
      const timer = window.setTimeout(() => {
        getCurrentWindow().close().catch(() => {});
      }, 1500);
      return () => window.clearTimeout(timer);
    }
  }, [issues.length, loading]);

  const handleSubmit = useCallback(
    async (issue: TesterIssue, vote: BugVote | ReviewVote, description?: string) => {
      setBusyIssueId(issue.id);
      try {
        await submitTesterVote({
          issueId: issue.id,
          kind: issue.pendingKind,
          vote,
          description,
        });
        toast.success(
          issue.pendingKind === "bug" ? "Bug validation submitted" : "Review vote submitted",
        );
        setIssues((prev) => prev.filter((i) => i.id !== issue.id));
      } catch (err) {
        console.error("[TesterWindow] vote submission failed:", err);
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: string }).message)
            : parseErrorMessage(err);
        toast.error(`Vote submission failed: ${msg}`);
      } finally {
        setBusyIssueId(null);
      }
    },
    [],
  );

  const { bugs, reviews } = useMemo(() => {
    const bugs: TesterIssue[] = [];
    const reviews: TesterIssue[] = [];
    for (const i of issues) {
      (i.pendingKind === "bug" ? bugs : reviews).push(i);
    }
    reviews.sort((a, b) => {
      const ar = a.header.reviewRound ?? 0;
      const br = b.header.reviewRound ?? 0;
      if (ar !== br) return br - ar;
      return (a.header.number ?? 0) - (b.header.number ?? 0);
    });
    bugs.sort((a, b) => (a.header.number ?? 0) - (b.header.number ?? 0));
    return { bugs, reviews };
  }, [issues]);

  const tabs: GroupTab[] = [
    { id: "review", name: "Fixes to review", count: reviews.length, icon: "solar:check-circle-bold" },
    { id: "bug", name: "Bugs to validate", count: bugs.length, icon: "solar:bug-bold" },
  ];

  const visibleCards = activeTab === "review" ? reviews : bugs;

  const renderCard = (issue: TesterIssue) => (
    <TesterIssueCard
      key={issue.id}
      issue={issue}
      busy={busyIssueId === issue.id}
      onSubmit={(vote, description) => handleSubmit(issue, vote, description)}
      onOpenIssue={() =>
        openExternalUrl(buildIssueUrl(issue)).catch((err) => {
          console.error("[TesterWindow] failed to open issue url:", err);
          toast.error("Could not open issue page");
        })
      }
    />
  );

  return (
    <div
      className="flex flex-col h-screen w-screen text-white overflow-hidden relative backdrop-blur-lg border-2"
      style={{
        backgroundColor: bgColor,
        backgroundImage: `linear-gradient(to bottom right, ${bgColor}, rgba(0,0,0,0.9))`,
        borderColor: `${accentColor.value}30`,
        boxShadow: `0 0 15px ${accentColor.value}30, inset 0 0 10px ${accentColor.value}20`,
      }}
    >
      <BorderGlow color={accentColor.value} />
      <TesterWindowTitlebar remaining={issues.length} />

      <div className="relative z-10 flex-1 min-h-0 flex flex-col p-4">
      <div className="shrink-0">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          {issues.length > 0 ? (
            <GroupTabs
              groups={tabs}
              activeGroup={activeTab}
              onGroupChange={(id) => setActiveTab(id as typeof activeTab)}
              showAddButton={false}
              className="!mb-0"
            />
          ) : (
            <div />
          )}
          <button
            onClick={reload}
            disabled={loading}
            className="shrink-0 p-2 rounded-md hover:bg-white/5 text-white/40 hover:text-white/80 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <Icon
              icon="solar:refresh-bold"
              className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar min-w-0 mt-4">
        <div className="max-w-3xl mx-auto">
          {loading && issues.length === 0 && (
            <div className="text-center py-16">
              <Icon
                icon="solar:refresh-bold"
                className="w-7 h-7 mx-auto animate-spin mb-3"
                style={{ color: accentColor.value }}
              />
              <div className="font-minecraft-ten text-xs uppercase tracking-wider text-white/50">
                Loading queue…
              </div>
            </div>
          )}

          {!loading && issues.length === 0 && (
            <div className="text-center py-16">
              <Icon
                icon="solar:check-circle-bold"
                className="w-12 h-12 mx-auto mb-3"
                style={{ color: accentColor.value }}
              />
              <div className="font-minecraft-ten text-base uppercase tracking-wider text-white">
                All caught up
              </div>
              <div className="text-sm text-white/50 mt-2 font-sans">
                Nothing's waiting on you right now. Closing this window…
              </div>
            </div>
          )}

          {!loading && issues.length > 0 && visibleCards.length === 0 && (
            <div className="text-center py-12">
              <Icon
                icon="solar:filter-bold"
                className="w-10 h-10 mx-auto mb-3 text-white/40"
              />
              <div className="font-minecraft-ten text-sm uppercase tracking-wider text-white/70">
                Nothing in this tab
              </div>
              <div className="text-sm text-white/50 mt-2 font-sans">
                Switch tab to see other pending items.
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">{visibleCards.map(renderCard)}</div>
        </div>
      </div>
      </div>
    </div>
  );
}

