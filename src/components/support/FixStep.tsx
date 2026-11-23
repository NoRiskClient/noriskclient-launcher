import { Icon } from "@iconify/react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/buttons/Button";
import { useClickGuard } from "../../hooks/useClickGuard";
import type { Profile } from "../../types/profile";
import { AccentIcon } from "./previews/common";
import { BackButton, CollectingProgress, Spinner, SupportFrame, type StepFlow } from "./parts";
import {
  getPreviewTemplate,
  getSupportItemDefinition,
  needsProfile,
  supportItemKey,
  type SupportItemTextPart,
} from "./supportItems";
import type { ActionPhase, PreparedItems } from "./usePreparedItems";

const AUTO_NEXT_MS = 800;
const FINISHED: ReadonlySet<ActionPhase | undefined> = new Set(["done", "declined"]);

export function FixStep({
  flow,
  items,
  cursor,
  profile,
}: {
  flow: StepFlow;
  items: PreparedItems;
  cursor: number;
  profile: Profile | null;
}) {
  const { t, i18n } = useTranslation();
  const { runnableActions, actions, actionRunning } = items;
  const position = Math.min(cursor, runnableActions.length - 1);
  const item = runnableActions[position];
  const armed = useClickGuard(item?.index);
  const phase = item ? actions[item.index] : undefined;
  const seen = useRef({ index: item?.index, phase });
  const next = useRef(flow.next);
  next.current = flow.next;

  useEffect(() => {
    const before = seen.current;
    seen.current = { index: item?.index, phase };
    if (before.index !== item?.index || before.phase === phase || !FINISHED.has(phase)) return;
    const timer = window.setTimeout(() => next.current(), phase === "done" ? AUTO_NEXT_MS : 0);
    return () => window.clearTimeout(timer);
  }, [item?.index, phase]);

  if (!item) {
    return (
      <SupportFrame onClose={flow.close} stepper={flow.stepper} left={<BackButton onClick={flow.back} />}>
        <CollectingProgress />
      </SupportFrame>
    );
  }

  const text = (part: SupportItemTextPart, fallback: string) => {
    const key = supportItemKey(item.type, part);
    return i18n.exists(key) ? t(key) : t(fallback);
  };
  const ActionPreview = getPreviewTemplate(item.type).Preview;
  const standalone = !needsProfile(item.type);
  const params = flow.info.items[item.index]?.params;

  return (
    <SupportFrame
      onClose={flow.close}
      busy={actionRunning}
      stepper={flow.stepper}
      left={standalone ? undefined : <BackButton onClick={flow.back} disabled={actionRunning} />}
      right={
        phase === "failed" ? (
          <Button variant="3d" size="lg" onClick={() => items.runAction(item.index)}>
            {t("support_request.retry")}
          </Button>
        ) : phase ? undefined : (
          <div className="flex gap-3">
            <Button variant="secondary" size="lg" onClick={() => items.declineAction(item.index)} disabled={!armed}>
              {text("no", "support_request.fix.no")}
            </Button>
            <Button variant="3d" size="lg" onClick={() => items.runAction(item.index)} disabled={!armed}>
              {text("yes", "support_request.fix.yes")}
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-4">
        {runnableActions.length > 1 && (
          <p className="font-minecraft text-sm text-white/50 tracking-wide">
            {t("support_request.fix.counter", { current: position + 1, total: runnableActions.length })}
          </p>
        )}
        <p className="font-minecraft text-xl text-white tracking-wide">
          {text("question", "support_request.fix.title")}
        </p>
        {ActionPreview && (standalone || item.action?.from || item.action?.to) ? (
          <ActionPreview item={item} ctx={{ profile, params }} />
        ) : (
          <div className="flex items-start gap-4 rounded-lg border-2 border-white/15 bg-black/20 p-4">
            <AccentIcon icon={getSupportItemDefinition(item.type)!.icon} className="w-10 h-10" />
            <p className="font-minecraft text-lg text-white/90 tracking-wide">
              {item.action?.description ?? t(supportItemKey(item.type, "label"))}
            </p>
          </div>
        )}
        {phase === "running" && <Spinner text={text("running", "support_request.fix.running")} />}
        {phase === "done" && (
          <p className="flex items-center gap-2 font-minecraft text-lg text-green-300 tracking-wide">
            <Icon icon="solar:check-circle-bold" className="w-6 h-6" />
            {text("done", "support_request.fix.done")}
          </p>
        )}
        {phase === "failed" && (
          <p className="font-minecraft text-lg text-white/85 tracking-wide">{text("failed", "support_request.fix.failed")}</p>
        )}
        {phase === "declined" && (
          <p className="font-minecraft text-lg text-white/70 tracking-wide">{t("support_request.fix.skipped")}</p>
        )}
      </div>
    </SupportFrame>
  );
}
