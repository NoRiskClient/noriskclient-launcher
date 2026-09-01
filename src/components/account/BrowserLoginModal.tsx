"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { listen, type Event as TauriEvent } from "@tauri-apps/api/event";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { EventType, type EventPayload } from "../../types/events";

interface BrowserLoginModalProps {
  onCancel: () => Promise<void>;
}

/**
 * Progress surface for the browser-based sign-in flow. Lives in its own file
 * because both the account manager and the launch-time login prompt open it.
 */
export function BrowserLoginModal({ onCancel }: BrowserLoginModalProps) {
  const { t } = useTranslation();
  const [loginStatus, setLoginStatus] = useState<string>(t('auth.startingLoginProcess'));
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen<EventPayload>("state_event", (event: TauriEvent<EventPayload>) => {
      const payload = event.payload;

      // Handle error events
      if (payload.event_type === EventType.Error && payload.error) {
        setError(payload.error);
        setLoginStatus(payload.message);
        return;
      }

      // Only handle account login events
      if (
        payload.event_type === EventType.AccountLoginStarted ||
        payload.event_type === EventType.AccountLoginWaitingForBrowser ||
        payload.event_type === EventType.AccountLoginExchangingToken ||
        payload.event_type === EventType.AccountLoginExchangingXboxToken ||
        payload.event_type === EventType.AccountLoginExchangingXstsToken ||
        payload.event_type === EventType.AccountLoginGettingMinecraftToken ||
        payload.event_type === EventType.AccountLoginCheckingEntitlements ||
        payload.event_type === EventType.AccountLoginFetchingProfile ||
        payload.event_type === EventType.AccountLoginCompleted
      ) {
        setError(null); // Clear error on successful progress
        setLoginStatus(payload.message);
        if (payload.progress !== null) {
          setProgress(payload.progress);
        }
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <Modal
      title={t('auth.browserLogin')}
      onClose={async () => {
        await onCancel();
      }}
      width="md"
    >
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3 mb-4">
          <Icon icon="solar:global-bold" className="w-8 h-8 text-white" />
          <div>
            <h3 className="text-base font-smallcaps text-white">
              {t('auth.signInViaBrowser')}
            </h3>
            <p className="text-sm text-white/70 font-minecraft mt-1">
              {t('auth.browserLoginDescription')}
            </p>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-500/20 backdrop-blur-md border border-red-500/40 p-4 rounded-md">
            <div className="flex items-start gap-2">
              <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-200 font-minecraft">
                <p className="font-semibold mb-1">{t('auth.loginError')}</p>
                <p className="text-red-300">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm">
            <span className={`font-minecraft ${error ? 'text-red-300' : 'text-white/80'}`}>
              {loginStatus}
            </span>
            {!error && (
              <span className="text-white/60 font-minecraft">{Math.round(progress)}%</span>
            )}
          </div>
          {!error && (
            <div className="w-full bg-black/40 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button
            variant="destructive"
            onClick={onCancel}
            icon={<Icon icon="solar:close-circle-bold" className="w-5 h-5" />}
            size="md"
          >
            {t('auth.cancelLogin')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
