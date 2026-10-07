"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { useThemeStore } from "../../store/useThemeStore";
import type { DetachMode } from "../../types/syncPacks";

export interface DetachModeModalProps {
  title: string;
  subtitle: string;
  confirmLabel: string;
  confirmLabels?: Partial<Record<DetachMode, string>>;
  choicePrefix?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (mode: DetachMode) => void;
}

const CHOICES: { mode: DetachMode; icon: string }[] = [
  { mode: "keep_copy", icon: "solar:copy-bold" },
  { mode: "drop", icon: "solar:link-broken-bold" },
];

export function DetachModeModal({
  title,
  subtitle,
  confirmLabel,
  confirmLabels,
  choicePrefix = "syncPacks.detachDialog",
  busy,
  onCancel,
  onConfirm,
}: DetachModeModalProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  const [mode, setMode] = useState<DetachMode>("keep_copy");
  const groupId = useId();

  return (
    <Modal
      title={title}
      titleSubtitle={
        <span className="font-minecraft text-xs normal-case text-white/45">
          {subtitle}
        </span>
      }
      onClose={() => { if (!busy) onCancel(); }}
      closeOnEscape={!busy}
      closeOnClickOutside={!busy}
      hideCloseButton={busy}
      width="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="md" onClick={() => { if (!busy) onCancel(); }} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="default"
            size="md"
            onClick={() => { if (!busy) onConfirm(mode); }}
            disabled={busy}
          >
            {confirmLabels?.[mode] ?? confirmLabel}
          </Button>
        </div>
      }
    >
      <fieldset disabled={busy} aria-busy={busy} className="space-y-3 px-8 pb-6 pt-5">
        <legend className="sr-only">{title}</legend>
        {CHOICES.map((choice) => {
          const active = mode === choice.mode;
          return (
            <label
              key={choice.mode}
              className={`relative flex w-full items-start gap-4 rounded-lg border px-5 py-4 text-left transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-white/80 focus-within:outline-offset-2 ${busy ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-white/5"}`}
              style={{
                borderColor: active
                  ? `${accentColor.value}66`
                  : "rgba(255,255,255,0.1)",
                backgroundColor: active
                  ? `${accentColor.value}12`
                  : "rgba(255,255,255,0.02)",
              }}
            >
              <input
                type="radio"
                name={groupId}
                value={choice.mode}
                checked={active}
                disabled={busy}
                onChange={() => { if (!busy) setMode(choice.mode); }}
                aria-labelledby={`${groupId}-${choice.mode}-title`}
                aria-describedby={`${groupId}-${choice.mode}-hint`}
                className="sr-only"
              />
              <Icon
                icon={choice.icon}
                aria-hidden="true"
                className="mt-0.5 h-5 w-5 flex-shrink-0"
                style={{
                  color: active ? accentColor.value : "rgba(255,255,255,0.35)",
                }}
              />
              <div className="min-w-0 flex-1">
                <div id={`${groupId}-${choice.mode}-title`} className="font-minecraft text-base text-white/90">
                  {t(`${choicePrefix}.${choice.mode}.title`)}
                </div>
                <div id={`${groupId}-${choice.mode}-hint`} className="mt-1 font-minecraft text-sm leading-relaxed text-white/45">
                  {t(`${choicePrefix}.${choice.mode}.hint`)}
                </div>
              </div>
              <Icon icon={active ? "solar:check-circle-bold" : "solar:record-linear"} aria-hidden="true" className="mt-0.5 h-5 w-5 flex-shrink-0" style={{ color: active ? accentColor.value : "rgba(255,255,255,0.35)" }} />
            </label>
          );
        })}
      </fieldset>
    </Modal>
  );
}

export default DetachModeModal;
