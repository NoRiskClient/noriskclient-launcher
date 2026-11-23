"use client";

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/buttons/Button";
import { useClickGuard } from "../../hooks/useClickGuard";
import type { Profile } from "../../types/profile";
import { BackButton, CollectingProgress, Spinner, SupportFrame, TextLink, type StepFlow } from "./parts";
import { getPreviewTemplate } from "./previews/registry";
import { getSupportItemDefinition, supportItemKey } from "./supportItems";
import type { PreparedItems } from "./usePreparedItems";

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

  if (!item) {
    return (
      <SupportFrame onClose={flow.close} stepper={flow.stepper} left={<BackButton onClick={flow.back} />}>
        <CollectingProgress />
      </SupportFrame>
    );
  }

  const questionKey = supportItemKey(item.type, "question");
  const phase = actions[item.index];
  const ActionPreview = getPreviewTemplate(item.type).Preview;

  return (
    <SupportFrame
      onClose={flow.close}
      busy={actionRunning}
      stepper={flow.stepper}
      left={<BackButton onClick={flow.back} disabled={actionRunning} />}
      right={
        phase ? (
          <Button variant="default" size="lg" onClick={flow.next} disabled={phase === "running"}>
            {t("support_request.next")}
          </Button>
        ) : (
          <div className="flex gap-3">
            <Button variant="secondary" size="lg" onClick={() => items.declineAction(item.index)}>
              {t("support_request.fix.no")}
            </Button>
            <Button variant="default" size="lg" onClick={() => items.runAction(item.index)} disabled={!armed}>
              {t("support_request.fix.yes")}
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
          {i18n.exists(questionKey) ? t(questionKey) : t("support_request.fix.title")}
        </p>
        {ActionPreview && (item.action?.from || item.action?.to) ? (
          <ActionPreview item={item} ctx={{ profile }} />
        ) : (
          <div className="flex items-start gap-4 rounded-lg border-2 border-white/15 bg-black/20 p-4">
            <Icon icon={getSupportItemDefinition(item.type)!.icon} className="w-10 h-10 shrink-0 text-amber-300" />
            <p className="font-minecraft text-lg text-white/90 tracking-wide">
              {item.action?.description ?? t(supportItemKey(item.type, "label"))}
            </p>
          </div>
        )}
        {phase === "running" && <Spinner text={t("support_request.fix.running")} />}
        {phase === "done" && (
          <p className="flex items-center gap-2 font-minecraft text-lg text-green-300 tracking-wide">
            <Icon icon="solar:check-circle-bold" className="w-6 h-6" />
            {t("support_request.fix.done")}
          </p>
        )}
        {phase === "failed" && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-minecraft text-lg text-white/85 tracking-wide">{t("support_request.fix.failed")}</p>
            <TextLink onClick={() => items.runAction(item.index)}>{t("support_request.retry")}</TextLink>
          </div>
        )}
        {phase === "declined" && (
          <p className="font-minecraft text-lg text-white/70 tracking-wide">{t("support_request.fix.skipped")}</p>
        )}
      </div>
    </SupportFrame>
  );
}
