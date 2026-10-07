import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useThemeStore } from "../../store/useThemeStore";
import { useFontStore } from "../../store/font-store";
import { GroupTabs, type GroupTab } from "../ui/GroupTabs";
import { WindowFrame } from "../ui/WindowFrame";
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
import { useTranslation } from "react-i18next";
import { useAnimationsEnabled } from "../../hooks/useEntranceAnimation";

const WEBSITE_BASE = "https://norisk.gg";

function buildIssueUrl(issue: TesterIssue): string {
  const slug = issue.header.slug || issue.header.number || issue.id;
  return `${WEBSITE_BASE}/issues/${slug}`;
}

export function TesterWindow() {
  const { t } = useTranslation();
  const animationsEnabled = useAnimationsEnabled();
  const accentColor = useThemeStore((state) => state.accentColor);
  const [issues, setIssues] = useState<TesterIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyIssueIds, setBusyIssueIds] = useState<Set<string>>(new Set());
  const pendingVotesRef = useRef(new Map<string, symbol>());
  const mountedRef = useRef(true);
  const [activeTab, setActiveTab] = useState<"bug" | "review">("review");
  const closeOnEmptyRef = useRef(false);
  const loadVersionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingVotesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const themeStore = useThemeStore.getState();
    themeStore.applyAccentColorToDOM();
    themeStore.applyBorderRadiusToDOM();
    useFontStore.getState().applyFontToDOM();
  }, []);

  const reload = useCallback(async () => {
    const version = ++loadVersionRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const resp = await fetchTesterQueue();
      if (version === loadVersionRef.current) setIssues(resp.docs);
    } catch (err) {
      if (version !== loadVersionRef.current) return;
      console.error("[TesterWindow] failed to fetch queue:", err);
      setLoadError(t("tester.queue.loadFailed"));
      toast.error(t("tester.queue.loadFailed"));
    } finally {
      if (version === loadVersionRef.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
    return () => { loadVersionRef.current++; };
  }, [reload]);

  useEffect(() => {
    if (issues.length > 0) {
      closeOnEmptyRef.current = true;
      return;
    }
    if (!loading && !loadError && closeOnEmptyRef.current) {
      const timer = window.setTimeout(() => {
        getCurrentWindow().close().catch(() => {});
      }, 1500);
      return () => window.clearTimeout(timer);
    }
  }, [issues.length, loading, loadError]);

  const handleSubmit = useCallback(
    async (issue: TesterIssue, vote: BugVote | ReviewVote, description?: string): Promise<boolean> => {
      if (!mountedRef.current || pendingVotesRef.current.has(issue.id)) return false;
      const request = Symbol(issue.id);
      pendingVotesRef.current.set(issue.id, request);
      setBusyIssueIds(new Set(pendingVotesRef.current.keys()));
      try {
        const response = await submitTesterVote({
          issueId: issue.id,
          kind: issue.pendingKind,
          vote,
          description,
        });
        if (!response?.ok) throw new Error(response?.error || t("common.error"));
        if (!mountedRef.current || pendingVotesRef.current.get(issue.id) !== request) return false;
        toast.success(
          issue.pendingKind === "bug" ? "Bug validation submitted" : "Review vote submitted",
        );
        setIssues((prev) => prev.filter((i) => i.id !== issue.id));
        return true;
      } catch (err) {
        if (!mountedRef.current || pendingVotesRef.current.get(issue.id) !== request) return false;
        console.error("[TesterWindow] vote submission failed:", err);
        const msg =
          err && typeof err === "object" && "message" in err
            ? String((err as { message: string }).message)
            : parseErrorMessage(err);
        toast.error(`Vote submission failed: ${msg}`);
        return false;
      } finally {
        if (pendingVotesRef.current.get(issue.id) === request) {
          pendingVotesRef.current.delete(issue.id);
          if (mountedRef.current) setBusyIssueIds(new Set(pendingVotesRef.current.keys()));
        }
      }
    },
    [t],
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
      busy={busyIssueIds.has(issue.id)}
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
    <WindowFrame>
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
            type="button"
            onClick={reload}
            disabled={loading}
            aria-label={t("common.refresh")}
            className="shrink-0 p-2 rounded-md hover:bg-white/5 text-white/40 hover:text-white/80 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            title={t("common.refresh")}
          >
            <Icon
              icon="solar:refresh-bold"
              aria-hidden="true"
              className={`w-4 h-4 ${loading && animationsEnabled ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar min-w-0 mt-4">
        <div className="max-w-3xl mx-auto">
          {loading && issues.length === 0 && (
            <div role="status" className="text-center py-16">
              <Icon
                icon="solar:refresh-bold"
                aria-hidden="true"
                className={`w-7 h-7 mx-auto mb-3 ${animationsEnabled ? "animate-spin" : ""}`}
                style={{ color: accentColor.value }}
              />
              <div className="font-minecraft text-xs tracking-wider text-white/50">
                {t("tester.queue.loading")}
              </div>
            </div>
          )}

          {!loading && loadError && (
            <div role="alert" className="py-10 text-center">
              <Icon icon="solar:danger-triangle-bold" aria-hidden="true" className="w-10 h-10 mx-auto mb-3 text-rose-400" />
              <div className="font-minecraft text-base text-white [overflow-wrap:anywhere]">{loadError}</div>
              <p className="mt-2 text-sm text-white/60 font-sans">{t("tester.queue.loadFailedHint")}</p>
              <button type="button" onClick={() => void reload()} className="mt-4 rounded-md border border-white/20 bg-white/5 px-4 py-2 font-minecraft text-sm text-white/85 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
                {t("common.retry")}
              </button>
            </div>
          )}

          {!loading && !loadError && issues.length === 0 && (
            <div role="status" className="text-center py-16">
              <Icon
                icon="solar:check-circle-bold"
                aria-hidden="true"
                className="w-12 h-12 mx-auto mb-3"
                style={{ color: accentColor.value }}
              />
              <div className="font-minecraft text-base tracking-wider text-white">
                {t("tester.queue.emptyTitle")}
              </div>
              <div className="text-sm text-white/50 mt-2 font-sans">
                {t(closeOnEmptyRef.current ? "tester.queue.closingHint" : "tester.queue.emptyHint")}
              </div>
            </div>
          )}

          {!loading && !loadError && issues.length > 0 && visibleCards.length === 0 && (
            <div className="text-center py-12">
              <Icon
                icon="solar:filter-bold"
                className="w-10 h-10 mx-auto mb-3 text-white/40"
              />
              <div className="font-minecraft text-sm tracking-wider text-white/70">
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
    </WindowFrame>
  );
}

