"use client";

import type React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { openExternalUrl } from "../../services/tauri-service";
import { useProfileLaunch } from "../../hooks/useProfileLaunch";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import type { CrashAction, CrashCheckResult } from "../../types/crash-analysis";
import { applyCrashFix, revertCrashFix, type AppliedFix } from "../../services/crash-fix-service";
import { useAppDragDropStore } from "../../store/appStore";
import { ContentType } from "../../types/content";
import { logError } from "../../utils/logging-utils";
import { actionColor, actionIcon, actionLabel, actionVariant, look, statusMessageText, summaryText } from "./crash-analysis-presenter";

interface Props {
  result: CrashCheckResult;
  profileId?: string; // present => real apply on this profile; absent (debug preview) => local toggle
  onClose: () => void;
}

export function CrashAnalysisModal({ result, profileId, onClose }: Props) {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  // index -> revert token (null = local-only toggle). Presence = applied.
  const [applied, setApplied] = useState<Map<number, AppliedFix | null>>(new Map());
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const l = look(result);

  const setBusyFlag = (i: number, on: boolean) =>
    setBusy((p) => {
      const n = new Set(p);
      if (on) n.add(i);
      else n.delete(i);
      return n;
    });

  // refresh the open mods tab
  const refreshMods = () => {
    try {
      useAppDragDropStore.getState().triggerRefresh(ContentType.Mod);
    } catch {
      /* tab not mounted — nothing to refresh */
    }
  };

  // apply on first click, undo on second. With a profileId -> Rust command; without -> local toggle.
  const onAction = async (a: CrashAction, i: number, direction?: "upgrade" | "downgrade") => {
    if (busy.has(i)) return;

    if (applied.has(i)) {
      const token = applied.get(i);
      setBusyFlag(i, true);
      try {
        if (profileId && token != null) {
          await revertCrashFix(token);
          refreshMods();
        }
        setApplied((p) => {
          const n = new Map(p);
          n.delete(i);
          return n;
        });
        toast(t("crash_analysis.toast.reverted", { target: a.target }), { icon: "↩️" });
      } catch (e) {
        logError(`Crash-fix revert failed: ${e}`);
        toast.error(t("crash_analysis.toast.apply_error"));
      } finally {
        setBusyFlag(i, false);
      }
      return;
    }

    if (!profileId) {
      setApplied((p) => new Map(p).set(i, null));
      toast.success(t("crash_analysis.toast.applied", { target: a.target }));
      return;
    }

    setBusyFlag(i, true);
    try {
      const outcome = await applyCrashFix(profileId, direction ? { ...a, direction } : a);
      if (outcome.status === "skipped") {
        toast(t("crash_analysis.toast.not_found", { target: outcome.reason }), { icon: "⚠️" });
      } else {
        setApplied((p) => new Map(p).set(i, outcome.fix));
        refreshMods();
        toast.success(t("crash_analysis.toast.applied", { target: a.target }));
      }
    } catch (e) {
      logError(`Crash-fix apply failed: ${e}`);
      toast.error(t("crash_analysis.toast.apply_error"));
    } finally {
      setBusyFlag(i, false);
    }
  };

  // canonical launch flow (UI launch-state, migration check, event/polling lifecycle)
  const { handleLaunch } = useProfileLaunch({ profileId: profileId ?? "" });
  const launchGame = () => {
    if (!profileId) {
      toast.success(t("crash_analysis.toast.launch")); // no profile -> nothing to launch
      return;
    }
    handleLaunch();
    onClose();
  };

  const hasActions = result.actions.length > 0;
  const summary = summaryText(result, t);
  const statusMsg = statusMessageText(result, t);

  const footer = (
    <Button
      variant="default"
      size="md"
      icon={<Icon icon="solar:play-bold" className="w-5 h-5" />}
      className="w-full justify-center"
      onClick={launchGame}
    >
      {t("crash_analysis.launch")}
    </Button>
  );

  return (
    <Modal
      title={t("crash_analysis.title")}
      titleIcon={<Icon icon="solar:shield-check-bold" className="w-7 h-7" style={{ color: l.color }} />}
      onClose={onClose}
      width="md"
      footer={footer}
    >
      <div className="p-6 space-y-4 text-white">
        <div
          className="flex items-start gap-3 rounded-lg p-4 border-l-[3px]"
          style={{ backgroundColor: `${l.color}14`, borderColor: l.color }}
        >
          <Icon icon={l.icon} className="w-8 h-8 shrink-0 mt-0.5" style={{ color: l.color }} />
          <div className="min-w-0">
            <p className="text-2xl font-minecraft lowercase leading-tight" style={{ color: l.color }}>
              {t(l.headlineKey)}
            </p>
            {summary && (
              <p className="text-base font-minecraft-ten text-gray-200 mt-1 leading-snug">
                {summary}
              </p>
            )}
            {result.module && (
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/10 px-2 py-1 text-sm font-minecraft-ten text-white/80">
                <Icon icon="solar:widget-2-bold" className="w-4 h-4" style={{ color: l.color }} />
                {t("crash_analysis.affected_feature")}: {result.module}
              </span>
            )}
          </div>
        </div>

        {/* authored workaround text from the wiki entry */}
        {result.workaround && (
          <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <Icon icon="solar:bandage-bold" className="w-5 h-5 shrink-0 mt-0.5 text-amber-400" />
            <p className="font-minecraft-ten text-base text-white/85 leading-snug">
              <span className="text-white/45">{t("crash_analysis.workaround_label")}: </span>
              {result.workaround}
            </p>
          </div>
        )}

        {/* fixes checklist (same render for 1 or many) */}
        {hasActions && (
          <div>
            <p className="px-1 pb-1.5 text-sm font-minecraft-ten text-white/40">{t("crash_analysis.fixes_heading")}</p>
            <div className="rounded-lg border border-white/10 bg-black/20 divide-y divide-white/5 overflow-hidden">
              {result.actions.map((a, i) => {
                const isApplied = applied.has(i);
                const isBusy = busy.has(i);
                const isConflict = a.type === "resolve_conflict";
                const badgeColor = isApplied ? "#22c55e" : actionColor(a, l.color);
                return (
                  <div key={i} className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.04]">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors"
                      style={{ backgroundColor: `${badgeColor}24`, color: badgeColor }}
                    >
                      <Icon icon={isApplied ? "solar:check-circle-bold" : actionIcon(a)} className="w-4 h-4" />
                    </span>
                    <span className={`flex-1 font-minecraft-ten text-base ${isApplied ? "text-white/45 line-through" : "text-white/90"}`}>
                      {actionLabel(a, t)}
                    </span>
                    {isConflict && !isApplied ? (
                      <div className="flex shrink-0 gap-1.5">
                        <Button
                          variant="success"
                          size="xs"
                          disabled={isBusy}
                          icon={<Icon icon={isBusy ? "solar:refresh-bold" : "solar:arrow-up-bold"} className={`w-4 h-4 ${isBusy ? "animate-spin" : ""}`} />}
                          onClick={() => onAction(a, i, "upgrade")}
                        >
                          {t("crash_analysis.upgrade")}
                        </Button>
                        <Button
                          variant="info"
                          size="xs"
                          disabled={isBusy}
                          icon={<Icon icon="solar:arrow-down-bold" className="w-4 h-4" />}
                          onClick={() => onAction(a, i, "downgrade")}
                        >
                          {t("crash_analysis.downgrade")}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant={isApplied ? "secondary" : actionVariant(a)}
                        size="xs"
                        iconPosition="right"
                        disabled={isBusy}
                        icon={
                          <Icon
                            icon={isBusy ? "solar:refresh-bold" : isApplied ? "solar:check-circle-bold" : "solar:arrow-right-bold"}
                            className={`w-4 h-4 ${isBusy ? "animate-spin" : ""}`}
                          />
                        }
                        onClick={() => onAction(a, i)}
                        title={isApplied ? t("crash_analysis.undo_hint") : undefined}
                      >
                        {isApplied ? t("crash_analysis.applied") : t("crash_analysis.apply")}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="px-1 pt-1.5 text-xs text-white/40 font-sans">{t("crash_analysis.applies_note")}</p>
          </div>
        )}

        {(statusMsg || result.issueUrl) && (
          <p className="text-base font-minecraft-ten text-gray-300 px-1">
            {statusMsg}
            {result.issueUrl && (
              <>
                {statusMsg ? " " : null}
                <button
                  onClick={() => openExternalUrl(result.issueUrl!).catch(() => {})}
                  className="inline font-minecraft-ten hover:underline underline-offset-2 whitespace-nowrap"
                  style={{ color: l.color }}
                >
                  {t("crash_analysis.view_issue")}
                  <Icon icon="solar:arrow-right-up-linear" className="inline-block w-3.5 h-3.5 ml-0.5 align-[-0.15em]" />
                </button>
              </>
            )}
          </p>
        )}

        {!hasActions && (
          <LinkRow
            icon="solar:document-text-linear"
            text={t("crash_analysis.open_crash_log")}
            onClick={() => openExternalUrl(`https://mclo.gs/${result.logId}`).catch(() => {})}
          />
        )}

        {/* technical details — collapsed by default, normal font */}
        <div className="pt-1">
          <button
            onClick={() => setShowDetails((s) => !s)}
            className="flex items-center gap-1.5 text-white/40 hover:text-white/70 font-minecraft-ten text-sm transition-colors"
          >
            <Icon icon={showDetails ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"} className="w-4 h-4" />
            {t("crash_analysis.technical_details")}
          </button>

          {showDetails && (
            <div className="mt-2 rounded-lg border border-white/10 bg-black/20 divide-y divide-white/5">
              <Fact label={t("crash_analysis.fact.feature")} value={result.module ?? null} />
              <Fact label={t("crash_analysis.fact.where")} value={result.blamer} />
              <Fact label={t("crash_analysis.fact.cause")} value={result.rootCause} />
              <Fact label={t("crash_analysis.fact.mod")} value={result.culpritMods.join(", ") || null} />
              <Fact label={t("crash_analysis.fact.type")} value={result.classification} />
              <div className="flex flex-wrap gap-2 p-3">
                <LinkRow
                  icon="solar:document-text-linear"
                  text={t("crash_analysis.open_log")}
                  onClick={() => openExternalUrl(`https://mclo.gs/${result.logId}`).catch(() => {})}
                />
                {result.wikiUrl && (
                  <LinkRow
                    icon="solar:book-2-linear"
                    text={t("crash_analysis.wiki_entry")}
                    onClick={() => openExternalUrl(result.wikiUrl!).catch(() => {})}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 px-3 py-2">
      <span className="shrink-0 w-16 text-xs uppercase tracking-wide text-white/40 font-sans pt-1">{label}</span>
      <span className="text-sm text-white/85 break-all font-sans">{value}</span>
    </div>
  );
}

function LinkRow({ icon, text, onClick }: { icon: string; text: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white font-minecraft-ten text-sm"
    >
      <Icon icon={icon} className="w-4 h-4" />
      {text}
    </button>
  );
}
