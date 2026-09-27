"use client";

import { Icon } from "@iconify/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { listen } from "@tauri-apps/api/event";
import { Modal } from "../ui/Modal";
import { Tooltip } from "../ui/Tooltip";
import { Button } from "../ui/buttons/Button";
import { CheckboxV2 } from "../ui/CheckboxV2";
import { AccountLinkRow } from "./AccountLinkRow";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { useLatest } from "../../hooks/useLatest";
import { openExternalUrl } from "../../services/tauri-service";
import { TwitchService } from "../../services/twitch-service";
import type { TwitchLoginPayload } from "../../types/twitch";
import { useSocialsModalStore } from "../../store/socials-modal-store";
import { useThemeStore } from "../../store/useThemeStore";

const SCOPE_INFO_MODAL_ID = "twitch-scope-info";
const LOGIN_MODAL_ID = "twitch-device-login";
const UNLINK_MODAL_ID = "twitch-deep-link-unlink";

interface TwitchLinkOptions {
  intro?: string;
  onFinish?: () => void;
}

export function useTwitchLinkFlow() {
  const { t } = useTranslation();
  const { showModal, hideModal } = useGlobalModal();

  return useCallback(
    ({ intro, onFinish }: TwitchLinkOptions = {}) => {
      const close = (id: string) => {
        hideModal(id);
        onFinish?.();
      };

      const startLogin = (scopes: string[]) =>
        showModal(
          LOGIN_MODAL_ID,
          <TwitchDeviceLoginModal
            scopes={scopes}
            onClose={() => {
              TwitchService.cancelLogin().catch((err) => console.error("Failed to cancel Twitch login:", err));
              close(LOGIN_MODAL_ID);
            }}
            onFailedToStart={() => {
              toast.error(t("twitch.linkFailed"));
              close(LOGIN_MODAL_ID);
            }}
            onCompleted={() => {
              toast.success(t("twitch.linked"));
              close(LOGIN_MODAL_ID);
            }}
          />,
        );

      showModal(
        SCOPE_INFO_MODAL_ID,
        <TwitchScopeInfoModal
          intro={intro}
          onClose={() => close(SCOPE_INFO_MODAL_ID)}
          onContinue={(scopes) => {
            hideModal(SCOPE_INFO_MODAL_ID);
            startLogin(scopes);
          }}
        />,
      );
    },
    [showModal, hideModal, t],
  );
}

export function useTwitchDeepLinkRequests() {
  const { t } = useTranslation();
  const { showModal, hideModal } = useGlobalModal();
  const startLink = useTwitchLinkFlow();

  useEffect(() => {
    const confirmUnlink = () => {
      const close = () => hideModal(UNLINK_MODAL_ID);
      showModal(
        UNLINK_MODAL_ID,
        <Modal
          title={t("deep_link.twitch.unlink")}
          onClose={close}
          width="sm"
          footer={
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  close();
                  TwitchService.unlink()
                    .then(() => toast.success(t("twitch.unlinked")))
                    .catch(() => toast.error(t("twitch.unlinkFailed")));
                }}
              >
                {t("deep_link.twitch.unlink")}
              </Button>
            </div>
          }
        >
          <div className="p-6 text-white/80 font-minecraft text-sm">
            <p>{t("deep_link.twitch.unlinkDescription")}</p>
          </div>
        </Modal>,
      );
    };

    const unlisten = listen<{ action: "link" | "unlink" | "change" }>(
      "deep-link-twitch-request",
      ({ payload: { action } }) => {
        if (action === "unlink") return confirmUnlink();
        startLink({ intro: t(`deep_link.twitch.${action}Description`) });
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [showModal, hideModal, startLink, t]);
}

export function TwitchLinkCard() {
  const { t } = useTranslation();
  const { openModal: openSocialsModal, closeModal: closeSocialsModal } = useSocialsModalStore();
  const startLink = useTwitchLinkFlow();
  const [isLinked, setIsLinked] = useState<boolean | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      setIsLinked(await TwitchService.isLinked());
    } catch (err) {
      console.error("Failed to load Twitch status:", err);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handleLink = () => {
    setIsBusy(true);
    closeSocialsModal();
    startLink({
      onFinish: () => {
        setIsBusy(false);
        openSocialsModal();
      },
    });
  };

  const handleUnlink = async () => {
    setIsBusy(true);
    try {
      await TwitchService.unlink();
      await refreshStatus();
      toast.success(t("twitch.unlinked"));
    } catch (err) {
      console.error("Failed to unlink Twitch:", err);
      toast.error(t("twitch.unlinkFailed"));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <AccountLinkRow
      icon="mdi:twitch"
      name="Twitch"
      info={t("socials.twitch_info")}
      iconClassName={isLinked ? "text-purple-400" : "text-white/50"}
      isLoading={isLinked === null}
      isLinked={isLinked ?? false}
      isProcessing={isBusy}
      onLink={handleLink}
      onUnlink={handleUnlink}
    />
  );
}

function TwitchScopeInfoModal({
  intro,
  onClose,
  onContinue,
}: {
  intro?: string;
  onClose: () => void;
  onContinue: (scopes: string[]) => void;
}) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const [available, setAvailable] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    TwitchService.getAvailableScopes()
      .then((scopes) => {
        setAvailable(scopes);
        setSelected(new Set(scopes));
      })
      .catch((err) => console.error("Failed to load Twitch scopes:", err));
  }, []);

  const toggle = (scope: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(scope)) next.add(scope);
      return next;
    });

  return (
    <Modal
      title={t("twitch.scopeInfoTitle")}
      titleIcon={<Icon icon="mdi:twitch" className="w-5 h-5" />}
      onClose={onClose}
      width="md"
    >
      <div className="p-6 font-minecraft text-sm text-white/70 select-none">
        {intro && (
          <p
            className="mb-4 rounded-md bg-black/20 px-3 py-2 text-white/85"
            style={{ borderLeft: `2px solid ${accentColor.value}` }}
          >
            {intro}
          </p>
        )}

        <p className="mb-3 text-xs text-white/60">{t("twitch.scopeInfoPick")}</p>
        <div className="rounded-md border border-white/10 bg-black/20 divide-y divide-white/5 overflow-hidden">
          {available.map((scope) => {
            const key = scope.split(":").join("_");
            return (
              <div
                key={scope}
                onClick={() => toggle(scope)}
                className="flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors hover:bg-white/5"
              >
                <CheckboxV2 checked={selected.has(scope)} onChange={() => undefined} size="sm" className="pointer-events-none" />
                <span className="flex-1 text-white/90">{t(`twitch.scope.${key}.title`)}</span>
                <code className="text-[10px] font-mono text-white/30">{scope}</code>
                <Tooltip content={t(`twitch.scope.${key}.description`)}>
                  <Icon icon="solar:info-circle-linear" className="w-4 h-4 text-white/30 hover:text-white/70" />
                </Tooltip>
              </div>
            );
          })}
        </div>

        <p className="mt-3 flex items-center gap-2 text-[11px] text-white/45">
          <Icon icon="solar:shield-check-bold" className="w-4 h-4 shrink-0" style={{ color: accentColor.value }} />
          {t("twitch.scopeInfoNoAutomation")}
        </p>

        <TwitchPrimaryAction
          label={t("twitch.scopeInfoContinue")}
          icon="mdi:twitch"
          onClick={() => onContinue(available.filter((scope) => selected.has(scope)))}
        />
      </div>
    </Modal>
  );
}

function TwitchPrimaryAction({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      variant="default"
      size="md"
      widthClassName="w-full"
      className="mt-6"
      icon={<Icon icon={icon} className="w-5 h-5" />}
    >
      {label}
    </Button>
  );
}

function TwitchDeviceLoginModal({
  scopes,
  onClose,
  onCompleted,
  onFailedToStart,
}: {
  scopes: string[];
  onClose: () => void;
  onCompleted: () => void;
  onFailedToStart: () => void;
}) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((s) => s.accentColor);
  const [payload, setPayload] = useState<TwitchLoginPayload | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const openedUri = useRef<string | null>(null);
  const onCompletedRef = useLatest(onCompleted);
  const onFailedToStartRef = useLatest(onFailedToStart);

  useEffect(() => {
    let disposed = false;
    const unlisten = TwitchService.onLoginEvent((event) => {
      if (disposed) return;
      setPayload(event);
      if (event.stage === "completed") onCompletedRef.current();
    });

    unlisten
      .then(() => TwitchService.beginDeviceLogin(scopes))
      .catch((err) => {
        if (disposed) return;
        console.error("Failed to start Twitch login:", err);
        onFailedToStartRef.current();
      });

    return () => {
      disposed = true;
      unlisten.then((fn) => fn());
    };
  }, [attempt]);

  const userCode = payload?.user_code ?? null;
  const verificationUri = payload?.verification_uri ?? null;
  const progress = payload?.progress ?? 0;
  const error =
    payload?.stage === "expired" ? t("twitch.codeExpired") : payload?.stage === "failed" ? payload.error : null;

  useEffect(() => {
    if (!verificationUri || openedUri.current === verificationUri) return;
    openedUri.current = verificationUri;
    openExternalUrl(verificationUri).catch((err) => console.error("Failed to open Twitch activation page:", err));
  }, [verificationUri]);

  const retry = () => {
    setPayload(null);
    setAttempt((current) => current + 1);
  };

  const handleCopy = async () => {
    if (!userCode) return;
    try {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy Twitch code:", err);
    }
  };

  return (
    <Modal
      title={t("twitch.linkTitle")}
      titleIcon={<Icon icon="mdi:twitch" className="w-5 h-5" />}
      onClose={onClose}
      width="sm"
    >
      <div className="p-6 flex flex-col items-center text-center font-minecraft">
        {error ? (
          <>
            <Icon icon="solar:danger-triangle-bold" className="w-10 h-10 text-red-400" />
            <h3 className="mt-3 text-white font-smallcaps">{t("twitch.linkError")}</h3>
            <p className="mt-1 text-sm text-white/70 leading-relaxed">{error}</p>
            <TwitchPrimaryAction label={t("common.try_again")} icon="solar:restart-bold" onClick={retry} />
          </>
        ) : (
          <>
            <p className="text-sm text-white/70 leading-relaxed">{t("twitch.linkInstructions")}</p>

            <span className="mt-5 text-xs text-white/50">{t("twitch.yourCode")}</span>
            {userCode ? (
              <Tooltip
                content={copied ? t("twitch.copied") : t("twitch.copyCode")}
                position="top"
                wrapperClassName="w-full"
              >
                <button
                  type="button"
                  onClick={handleCopy}
                  className="mt-1 w-full rounded-lg bg-black/30 px-4 py-3 text-3xl tracking-[0.35em] text-white border border-white/10 hover:bg-black/40 transition-colors"
                  style={{ borderBottom: `2px solid ${accentColor.value}` }}
                >
                  {userCode}
                </button>
              </Tooltip>
            ) : (
              <div className="mt-1 w-full rounded-lg bg-black/30 py-4 border border-white/10">
                <Icon icon="svg-spinners:ring-resize" className="w-8 h-8 mx-auto text-white/70" />
              </div>
            )}

            <div className="mt-4 w-full">
              <div className="flex items-center justify-between text-xs text-white/60">
                <span className="flex items-center gap-2">
                  <Icon icon="svg-spinners:3-dots-fade" className="w-4 h-4" style={{ color: accentColor.value }} />
                  {payload?.stage === "awaiting_user" ? t("twitch.waiting") : t("twitch.starting")}
                </span>
                {payload?.expires_in != null && <span>{formatRemaining(payload.expires_in)}</span>}
              </div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full transition-all duration-300 ease-out"
                  style={{ width: `${100 - progress}%`, backgroundColor: accentColor.value }}
                />
              </div>
            </div>

            <TwitchPrimaryAction
              label={t("twitch.openTwitch")}
              icon="mdi:open-in-new"
              onClick={() => verificationUri && openExternalUrl(verificationUri)}
              disabled={!verificationUri}
            />
          </>
        )}
      </div>
    </Modal>
  );
}

function formatRemaining(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${(safe % 60).toString().padStart(2, "0")}`;
}
