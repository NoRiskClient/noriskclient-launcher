"use client";

import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Button } from "../ui/buttons/Button";
import { useClickGuard } from "../../hooks/useClickGuard";
import { SupportRequestService } from "../../services/support-request-service";
import type { Profile } from "../../types/profile";
import type { PreparedItem } from "../../types/support-request";
import { BackButton, SMALL_SPINNER, SendHeader, CollectingProgress, Status, SupportFrame, type StepFlow } from "./parts";
import { RawPreview, getPreviewTemplate, isPartiallyShown } from "./previews/registry";
import type { SupportPreviewContext } from "./previews/types";
import { SupportKidItemRow } from "./SupportRequestItems";
import { getSupportItemDefinition, supportItemKey } from "./supportItems";
import { isCollectSelectable, type PreparedItems } from "./usePreparedItems";

function ItemPreview({
  item,
  ctx,
  selected,
  onToggle,
  onBack,
}: {
  item: PreparedItem;
  ctx: SupportPreviewContext;
  selected: boolean;
  onToggle: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const def = getSupportItemDefinition(item.type);
  const Preview = getPreviewTemplate(item.type).Preview ?? RawPreview;
  return (
    <motion.div
      key={item.index}
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18 }}
      className="flex flex-col h-[360px]"
    >
      <div className="flex items-center gap-3 pb-2 mb-2 border-b border-white/10">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 font-minecraft text-sm text-white/85 tracking-wide hover:bg-white/15"
        >
          <Icon icon="solar:arrow-left-linear" className="w-4 h-4" />
          {t("support_request.back")}
        </button>
        {def && <Icon icon={def.icon} className="w-5 h-5 text-white/70" />}
        <span className="min-w-0 truncate font-minecraft text-base text-white tracking-wide">
          {def ? t(supportItemKey(item.type, "label")) : item.type}
        </span>
      </div>
      {isPartiallyShown(item) && (
        <p className="mb-2 font-minecraft text-xs text-white/55 tracking-wide">{t("support_request.preview.partial")}</p>
      )}
      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar pr-1">
        <Preview item={item} ctx={ctx} />
      </div>
      {isCollectSelectable(item) && (
        <div className="pt-2 mt-2 border-t border-white/10 flex justify-end">
          <Button variant={selected ? "ghost" : "secondary"} size="sm" onClick={onToggle}>
            {selected ? t("support_request.data.exclude") : t("support_request.data.include")}
          </Button>
        </div>
      )}
    </motion.div>
  );
}

export function DataStep({
  flow,
  items,
  profile,
  profilesReady,
  onSent,
}: {
  flow: StepFlow;
  items: PreparedItems;
  profile: Profile | null;
  profilesReady: boolean;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const armed = useClickGuard(previewIndex);
  const { prepared, preparing, selected, selection } = items;
  const name = flow.info.requestedBy.displayName;
  const ctx: SupportPreviewContext = { profile };
  const loading = preparing || !prepared;
  const previewItem = previewIndex === null ? null : (prepared?.find((i) => i.index === previewIndex) ?? null);

  const submit = async () => {
    if (selection.length === 0 || sending) return;
    setSending(true);
    try {
      await SupportRequestService.submit(flow.code, selection);
      onSent();
    } catch (e) {
      flow.showError(e);
    } finally {
      setSending(false);
    }
  };

  if (!profile && profilesReady) {
    return (
      <SupportFrame onClose={flow.close} stepper={flow.stepper} left={<BackButton onClick={flow.back} />}>
        <Status icon="solar:question-circle-bold" tone="info" title={t("support_request.profile.none")} />
      </SupportFrame>
    );
  }

  if (!loading && previewItem) {
    return (
      <SupportFrame onClose={flow.close} stepper={flow.stepper}>
        <ItemPreview
          item={previewItem}
          ctx={ctx}
          selected={selected.has(previewItem.index)}
          onToggle={() => items.toggleSelected(previewItem.index)}
          onBack={() => setPreviewIndex(null)}
        />
      </SupportFrame>
    );
  }

  const missingNames = items.missingItems.map((i) => t(supportItemKey(i.type, "label")));
  const notFoundLine = [
    missingNames.length > 0 ? t("support_request.data.missing", { names: missingNames.join(", ") }) : null,
    items.unsupportedCount > 0 ? t("support_request.data.unsupported", { count: items.unsupportedCount }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <SupportFrame
      onClose={flow.close}
      busy={sending}
      stepper={flow.stepper}
      left={<BackButton onClick={flow.back} disabled={loading || sending} />}
      right={
        <Button
          variant="success"
          size="lg"
          onClick={submit}
          disabled={loading || selection.length === 0 || sending || !armed}
          icon={sending ? SMALL_SPINNER : undefined}
        >
          {sending ? t("support_request.send.sending") : t("support_request.send.button", { name })}
        </Button>
      }
    >
      {loading ? (
        <CollectingProgress />
      ) : (
        <div className="space-y-3">
          <SendHeader info={flow.info} title={t("support_request.data.title", { name })} />
          {items.dataItems.length > 0 && (
            <div className="max-h-[300px] overflow-y-auto overflow-x-hidden custom-scrollbar rounded-md border border-white/10 divide-y divide-white/10">
              {items.dataItems.map((item) => (
                <SupportKidItemRow
                  key={item.index}
                  type={item.type}
                  selected={selected.has(item.index)}
                  summary={getPreviewTemplate(item.type).summarize?.(item, t, ctx)}
                  disabled={sending}
                  onOpen={() => setPreviewIndex(item.index)}
                />
              ))}
            </div>
          )}
          {notFoundLine && <p className="font-minecraft text-sm text-white/40 tracking-wide">{notFoundLine}</p>}
          {selection.length === 0 && (
            <p className="font-minecraft text-sm text-amber-300 tracking-wide">{t("support_request.send.nothing")}</p>
          )}
          <p className="flex items-center gap-1.5 font-minecraft text-sm text-white/45 tracking-wide">
            <Icon icon="solar:lock-keyhole-bold" className="w-4 h-4 shrink-0" />
            {t("support_request.data.privacy")}
          </p>
        </div>
      )}
    </SupportFrame>
  );
}
