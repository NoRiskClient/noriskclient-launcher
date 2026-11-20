import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { useThemeStore } from "../../store/useThemeStore";
import { formatClipLength } from "../../utils/time-utils";
import {
  offersChoice,
  SHARE_TITLE_MAX,
  type ShareChoices,
  type ShareOptions,
} from "../../services/share-service";

export interface ShareSubject {
  kind: "clip" | "screenshot";
  name: string;
  preview: string | null;
  durationSeconds?: number | null;
  server?: string | null;
}

interface Props {
  subject: ShareSubject;
  choices: ShareChoices | null;
  onClose: () => void;
  onShare: (options: ShareOptions) => void;
}

const PERMANENT = "permanent";
type Choice = number | typeof PERMANENT;

const DAY_MS = 24 * 60 * 60 * 1000;

function initialPick(choices: ShareChoices | null): Choice | null {
  if (!offersChoice(choices)) return null;
  if (choices.expiryChoices.includes(choices.expiryDays)) return choices.expiryDays;
  return choices.expiryChoices[choices.expiryChoices.length - 1] ?? PERMANENT;
}

function withoutExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).slice(0, SHARE_TITLE_MAX);
}

export function ShareModal({ subject, choices, onClose, onShare }: Props) {
  const { t, i18n } = useTranslation();
  const accent = useThemeStore((state) => state.accentColor.value);
  const [title, setTitle] = useState(() => withoutExtension(subject.name));
  const [showServer, setShowServer] = useState(true);
  const [picked, setPicked] = useState<Choice | null>(() => initialPick(choices));

  const options: Choice[] = offersChoice(choices)
    ? [...choices.expiryChoices, ...(choices.permanentChoice ? [PERMANENT as Choice] : [])]
    : [];
  const days = typeof picked === "number" ? picked : picked === null ? choices?.expiryDays : null;
  const until = days
    ? new Date(Date.now() + days * DAY_MS).toLocaleDateString(i18n.language, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;
  const isClip = subject.kind === "clip";

  const submit = () =>
    onShare({
      title: title.trim() || undefined,
      expiry:
        picked === null ? undefined : picked === PERMANENT ? { permanent: true } : { days: picked },
      hideServer: isClip && !!subject.server && !showServer,
    });

  return (
    <Modal
      title={isClip ? t("share.dialog.title_clip") : t("share.dialog.title_screenshot")}
      titleIcon={<Icon icon="solar:cloud-upload-bold" className="w-5 h-5" />}
      onClose={onClose}
      width="md"
      footer={
        <div className="flex justify-between">
          <Button variant="secondary" size="md" className="text-base" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="default"
            size="md"
            className="text-base"
            onClick={submit}
            icon={<Icon icon="solar:cloud-upload-bold" className="w-5 h-5 text-white" />}
          >
            {t("share.dialog.share")}
          </Button>
        </div>
      }
    >
      <div className="space-y-5 p-6">
        <div className="flex items-center gap-4 rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-md bg-black">
            {subject.preview ? (
              <img src={subject.preview} alt="" draggable={false} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Icon
                  icon={isClip ? "solar:videocamera-bold" : "solar:gallery-bold"}
                  className="h-6 w-6 text-white/20"
                />
              </div>
            )}
            {isClip && subject.durationSeconds != null && (
              <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/70 px-1 font-minecraft text-[10px] text-white/80">
                {formatClipLength(subject.durationSeconds)}
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex items-center justify-between gap-2 font-minecraft text-xs text-white/40">
              <span className="flex items-center gap-1.5">
                <Icon icon={isClip ? "solar:videocamera-bold" : "solar:gallery-bold"} className="h-3.5 w-3.5" />
                {isClip ? t("share.dialog.kind_clip") : t("share.dialog.kind_screenshot")}
              </span>
              <span>
                {title.length}/{SHARE_TITLE_MAX}
              </span>
            </span>
            <label className="group flex items-center gap-2 border-b border-white/15 pb-1 transition-colors focus-within:border-white/50 hover:border-white/30">
              <input
                value={title}
                maxLength={SHARE_TITLE_MAX}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={withoutExtension(subject.name)}
                aria-label={t("share.dialog.title_label")}
                spellCheck={false}
                autoComplete="off"
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submit();
                }}
                className="min-w-0 flex-1 bg-transparent font-minecraft text-base text-white placeholder-white/40 outline-none normal-case"
              />
              <Icon icon="solar:pen-bold" className="h-4 w-4 shrink-0 text-white/40 group-focus-within:text-white/80" />
            </label>
          </div>
        </div>

        {isClip && subject.server && (
          <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/30 px-4 py-3">
            <Icon icon="solar:server-bold" className="h-5 w-5 shrink-0 text-white/50" />
            <div className="min-w-0 flex-1">
              <p className="font-smallcaps text-sm text-white">{t("share.dialog.server_label")}</p>
              <p className="truncate font-minecraft text-xs text-white/50 normal-case">{subject.server}</p>
            </div>
            <ToggleSwitch checked={showServer} onChange={setShowServer} size="sm" />
          </div>
        )}

        {options.length > 0 && (
          <div>
            <label className="mb-2 block font-smallcaps text-base text-white">
              {t("share.dialog.expiry_label")}
            </label>
            <div className="flex flex-wrap gap-2">
              {options.map((option) => {
                const active = picked === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setPicked(option)}
                    aria-pressed={active}
                    className={`rounded-md border px-3 py-1.5 font-minecraft text-sm transition-colors ${
                      active ? "text-white" : "border-white/10 bg-black/30 text-white/60 hover:border-white/25 hover:text-white"
                    }`}
                    style={active ? { backgroundColor: `${accent}33`, borderColor: accent } : undefined}
                  >
                    {option === PERMANENT ? t("share.expiry.permanent") : t("share.expiry.days", { count: option })}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {(until || picked === PERMANENT) && (
          <p className="flex items-center gap-2 font-minecraft text-xs text-white/50">
            <Icon icon="solar:clock-circle-bold" className="h-4 w-4 shrink-0" />
            {picked === PERMANENT
              ? t("share.expiry.permanent_hint", { max: choices?.maxPinned ?? 0 })
              : t("share.dialog.until", { date: until })}
          </p>
        )}
      </div>
    </Modal>
  );
}
