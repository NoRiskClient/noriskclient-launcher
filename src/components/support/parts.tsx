"use client";

import { Fragment, type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { PlayerHead } from "../common/PlayerHead";
import { useAddMinecraftAccount } from "../../hooks/useAddMinecraftAccount";
import { useMinecraftAuthStore } from "../../store/minecraft-auth-store";
import { useThemeStore } from "../../store/useThemeStore";
import { cn } from "../../lib/utils";
import type { PrepareStep, SupportRequestInfo } from "../../types/support-request";
import { supportItemKey } from "./supportItems";
import type { ShowError } from "./useSupportRequest";

export interface StepFlow {
  code: string;
  info: SupportRequestInfo;
  stepper: { count: number; current: number };
  close: () => void;
  next: () => void;
  back: () => void;
  showError: ShowError;
}

export function SupportFrame({
  onClose,
  busy = false,
  stepper,
  left,
  right,
  children,
}: {
  onClose: () => void;
  busy?: boolean;
  stepper?: StepFlow["stepper"];
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      title={t("support_request.title")}
      titleIcon={<Icon icon="solar:chat-round-dots-bold" className="w-6 h-6" />}
      onClose={() => !busy && onClose()}
      width="md"
      closeOnClickOutside={false}
      footer={
        <div className="flex items-center gap-3 min-h-[44px]">
          <div className="min-w-0">{left}</div>
          <div className="ml-auto">{right}</div>
        </div>
      }
    >
      <div className="px-6 pt-5 pb-1 min-w-0 overflow-x-hidden">
        {stepper && <Stepper count={stepper.count} current={stepper.current} />}
        {children}
      </div>
    </Modal>
  );
}

export function BackButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <Button variant="ghost" onClick={onClick} disabled={disabled}>
      {t("support_request.back")}
    </Button>
  );
}

export function useAccentStyle(): CSSProperties {
  const accent = useThemeStore((s) => s.accentColor.value);
  return { borderColor: `${accent}80`, backgroundColor: `${accent}25` };
}

function AvatarFrame({ small, title, children }: { small: boolean; title?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "shrink-0 rounded-lg border-2 overflow-hidden flex items-center justify-center",
        small ? "w-9 h-9" : "w-20 h-20",
      )}
      style={useAccentStyle()}
      title={title}
    >
      {children}
    </div>
  );
}

export function SupporterAvatar({ info, small = false }: { info: SupportRequestInfo; small?: boolean }) {
  const { avatarUrl, minecraftUuid, displayName: name } = info.requestedBy;
  const [remoteFailed, setRemoteFailed] = useState(false);
  return (
    <AvatarFrame small={small} title={name}>
      {minecraftUuid ? (
        <PlayerHead uuid={minecraftUuid} username={name} size={small ? 32 : 72} className={small ? "text-base" : "text-3xl"} />
      ) : avatarUrl && /^https:\/\//i.test(avatarUrl) && !remoteFailed ? (
        <img src={avatarUrl} alt={name} draggable={false} onError={() => setRemoteFailed(true)} className="w-full h-full object-cover" />
      ) : (
        <Icon icon="solar:user-bold" className={small ? "w-5 h-5 text-white/60" : "w-12 h-12 text-white/60"} />
      )}
    </AvatarFrame>
  );
}

export function SendHeader({ info, title }: { info: SupportRequestInfo; title: string }) {
  const accountCount = useMinecraftAuthStore((s) => s.accounts.length);
  const ign = info.account.ign.trim();
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="flex flex-col items-center">
          <AvatarFrame small title={ign || undefined}>
            <PlayerHead uuid={info.account.id} username={ign} size={32} className="text-base" />
          </AvatarFrame>
          {accountCount > 1 && ign && (
            <span className="max-w-[72px] truncate font-minecraft text-[10px] leading-tight text-white/50 tracking-wide">{ign}</span>
          )}
        </div>
        <span className="w-4 h-0.5 rounded bg-white/25" />
        <Icon icon="solar:plain-bold" className="w-4 h-4 text-white/60" />
        <span className="w-4 h-0.5 rounded bg-white/25" />
        <SupporterAvatar info={info} small />
      </div>
      <p className="min-w-0 font-minecraft text-xl text-white tracking-wide">{title}</p>
    </div>
  );
}

const STATUS_COLORS = { good: "text-green-400", bad: "text-red-400", info: "text-white/70" } as const;

export function Status({
  icon,
  tone,
  title,
  text,
  centered = false,
}: {
  icon: string;
  tone: keyof typeof STATUS_COLORS;
  title: string;
  text?: ReactNode;
  centered?: boolean;
}) {
  return (
    <div className={cn("flex", centered ? "flex-col items-center text-center gap-3 py-4" : "items-start gap-4 py-2")}>
      <Icon icon={icon} className={cn(centered ? "w-20 h-20" : "w-12 h-12 shrink-0", STATUS_COLORS[tone])} />
      <div className={cn("min-w-0 flex flex-col", centered ? "items-center gap-3" : "gap-1")}>
        <p className="font-minecraft text-2xl text-white tracking-wide">{title}</p>
        {text && <p className={cn("font-minecraft text-lg text-white/80 tracking-wide", centered && "max-w-md")}>{text}</p>}
      </div>
    </div>
  );
}

export function Stepper({ count, current }: { count: number; current: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-5" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <Fragment key={i}>
          {i > 0 && <span className={cn("w-8 h-0.5 rounded", i <= current ? "bg-green-400/70" : "bg-white/15")} />}
          <span
            className={cn(
              "w-8 h-8 rounded-full border-2 flex items-center justify-center font-minecraft text-sm",
              i < current
                ? "bg-green-500/70 border-green-400 text-white"
                : i === current
                  ? "bg-white/15 border-white text-white"
                  : "border-white/20 text-white/40",
            )}
          >
            {i < current ? <Icon icon="solar:check-circle-bold" className="w-5 h-5" /> : i + 1}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

export const SMALL_SPINNER = <Icon icon="svg-spinners:ring-resize" className="w-4 h-4" />;

export function CollectingProgress() {
  const { t } = useTranslation();
  const accent = useThemeStore((s) => s.accentColor.value);
  const [step, setStep] = useState<PrepareStep | null>(null);

  useEffect(() => {
    const stop = listen<PrepareStep>("support:prepare_step", (event) => setStep(event.payload));
    return () => {
      void stop.then((unlisten) => unlisten());
    };
  }, []);

  const percent = step ? Math.round(((step.index + 0.5) / step.total) * 100) : 0;

  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <Icon icon="svg-spinners:ring-resize" className="w-10 h-10 text-white/80" />
      <span className="font-minecraft text-lg tracking-wide text-white/80">{t("support_request.data.collecting")}</span>
      <div className="w-full max-w-xs space-y-2">
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%`, backgroundColor: accent }}
          />
        </div>
        <div className="flex items-center justify-between gap-3 font-minecraft text-sm tracking-wide text-white/60">
          <span className="truncate">{step ? t(supportItemKey(step.itemType, "label")) : " "}</span>
          {step && (
            <span className="shrink-0 tabular-nums">
              {step.index + 1} / {step.total}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function Spinner({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-white/80 font-minecraft text-lg tracking-wide">
      <Icon icon="svg-spinners:ring-resize" className="w-12 h-12" />
      <span>{text}</span>
    </div>
  );
}

export function TextLink({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-minecraft text-sm tracking-wide text-white/50 hover:text-white underline underline-offset-2 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function LoginButton() {
  const { t } = useTranslation();
  const { startLogin } = useAddMinecraftAccount();
  return (
    <Button variant="default" size="lg" onClick={() => startLogin()}>
      {t("support_request.error.login_button")}
    </Button>
  );
}
