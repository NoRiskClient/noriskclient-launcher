"use client";

import { Icon } from "@iconify/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { IconButton } from "../ui/buttons/IconButton";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { openExternalUrl } from "../../services/tauri-service";
import { TwitchService } from "../../services/twitch-service";
import type { TwitchLoginPayload, TwitchStatus } from "../../types/twitch";
import { useSocialsModalStore } from "../../store/socials-modal-store";

const MODAL_ID = "twitch-device-login-modal";

export function TwitchLinkCard() {
  const { t } = useTranslation();
  const { showModal, hideModal } = useGlobalModal();
  const { openModal: openSocialsModal, closeModal: closeSocialsModal } = useSocialsModalStore();
  const [status, setStatus] = useState<TwitchStatus | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await TwitchService.getStatus());
    } catch (err) {
      console.error("Failed to load Twitch status:", err);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handleLink = async () => {
    setIsBusy(true);
    closeSocialsModal();
    showModal(
      MODAL_ID,
      <TwitchDeviceLoginModal
        onClose={async () => {
          hideModal(MODAL_ID);
          try {
            await TwitchService.cancelLogin();
          } catch (err) {
            console.error("Failed to cancel Twitch login:", err);
          }
          openSocialsModal();
          setIsBusy(false);
        }}
        onCompleted={async () => {
          hideModal(MODAL_ID);
          setIsBusy(false);
          await refreshStatus();
          openSocialsModal();
          toast.success(t("twitch.linked"));
        }}
      />,
    );

    try {
      await TwitchService.beginDeviceLogin();
    } catch (err) {
      console.error("Failed to start Twitch login:", err);
      hideModal(MODAL_ID);
      openSocialsModal();
      setIsBusy(false);
      toast.error(t("twitch.linkFailed"));
    }
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

  const isLinked = status?.linked ?? false;

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 bg-black/20 rounded-md min-h-[58px]">
        <div className="flex items-center min-w-0">
          <Icon
            icon="mdi:twitch"
            className={`w-6 h-6 mr-3 flex-shrink-0 ${isLinked ? "text-purple-400" : "text-white/50"}`}
          />
          <div className="min-w-0">
            <p className="text-white/90 font-minecraft text-xs">Twitch</p>
            <p className="text-white/55 font-minecraft text-[10px] leading-tight">
              {t("socials.twitch_info")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isLinked ? (
            <Button
              variant="destructive"
              onClick={handleUnlink}
              disabled={isBusy}
              size="sm"
              widthClassName="w-[140px]"
              icon={<Icon icon="mdi:link-off" className="w-4 h-4" />}
            >
              {t("socials.button.unlink")}
            </Button>
          ) : (
            <Button
              variant="default"
              onClick={handleLink}
              disabled={isBusy}
              size="sm"
              widthClassName="w-[140px]"
              icon={
                <Icon
                  icon={isBusy ? "mdi:loading" : "mdi:link-variant"}
                  className={`w-4 h-4 ${isBusy ? "animate-spin" : ""}`}
                />
              }
            >
              {t("socials.button.link")}
            </Button>
          )}
          <IconButton
            variant="ghost"
            size="sm"
            icon={<Icon icon="mdi:open-in-new" className="w-5 h-5" />}
            className="invisible"
            disabled
          />
        </div>
    </div>
  );
}

interface TwitchDeviceLoginModalProps {
  onClose: () => Promise<void>;
  onCompleted: () => Promise<void>;
}

function TwitchDeviceLoginModal({
  onClose,
  onCompleted,
}: TwitchDeviceLoginModalProps) {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<TwitchLoginPayload | null>(null);
  const [copied, setCopied] = useState(false);
  // Ref keeps the listener callback stable while still seeing the latest handler.
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;

    TwitchService.onLoginEvent((event) => {
      setPayload(event);
      if (event.stage === "completed") {
        onCompletedRef.current();
      }
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const userCode = payload?.user_code ?? null;
  const verificationUri = payload?.verification_uri ?? null;
  const progress = payload?.progress ?? 0;
  const error = payload?.error ?? null;

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

  const handleOpen = async () => {
    if (!verificationUri) return;
    try {
      await openExternalUrl(verificationUri);
    } catch (err) {
      console.error("Failed to open Twitch activation page:", err);
    }
  };

  return (
    <Modal title={t("twitch.linkTitle")} onClose={onClose} width="md">
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Icon icon="mdi:twitch" className="w-8 h-8 text-purple-400" />
          <div>
            <h3 className="text-base font-smallcaps text-white">
              {t("twitch.linkHeadline")}
            </h3>
            <p className="text-sm text-white/70 font-minecraft mt-1">
              {t("twitch.linkInstructions")}
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/20 backdrop-blur-md border border-red-500/40 p-4 rounded-md">
            <div className="flex items-start gap-2">
              <Icon
                icon="solar:danger-triangle-bold"
                className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5"
              />
              <div className="text-sm text-red-200 font-minecraft">
                <p className="font-semibold mb-1">{t("twitch.linkError")}</p>
                <p className="text-red-300">{error}</p>
              </div>
            </div>
          </div>
        )}

        {userCode ? (
          <div className="bg-black/40 border-2 border-white/20 rounded-md p-4 text-center space-y-3">
            <p className="text-sm text-white/60 font-minecraft">
              {t("twitch.yourCode")}
            </p>
            <button
              type="button"
              onClick={handleCopy}
              className="text-3xl tracking-[0.4em] text-white font-minecraft hover:text-purple-300 transition-colors"
              title={t("twitch.copyCode")}
            >
              {userCode}
            </button>
            <p className="text-sm text-white/50 font-minecraft">
              {copied ? t("twitch.copied") : t("twitch.clickToCopy")}
            </p>
          </div>
        ) : (
          !error && (
            <div className="py-6 text-center">
              <Icon
                icon="svg-spinners:ring-resize"
                className="w-8 h-8 mx-auto text-white/70"
              />
            </div>
          )
        )}

        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm">
            <span
              className={`font-minecraft ${error ? "text-red-300" : "text-white/80"}`}
            >
              {payload?.message ?? t("twitch.starting")}
            </span>
            {payload?.expires_in != null && !error && (
              <span className="text-white/60 font-minecraft">
                {formatRemaining(payload.expires_in)}
              </span>
            )}
          </div>
          {!error && (
            <div className="w-full bg-black/40 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-purple-600 transition-all duration-300 ease-out"
                style={{ width: `${100 - progress}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button
            variant="destructive"
            onClick={onClose}
            icon={<Icon icon="solar:close-circle-bold" className="w-5 h-5" />}
            size="md"
          >
            {t("twitch.cancel")}
          </Button>
          <Button
            variant="default"
            onClick={handleOpen}
            disabled={!verificationUri}
            icon={<Icon icon="solar:global-bold" className="w-5 h-5" />}
            size="md"
          >
            {t("twitch.openTwitch")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function formatRemaining(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
