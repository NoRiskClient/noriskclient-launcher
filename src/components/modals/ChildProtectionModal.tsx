"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { type Event as TauriEvent, listen } from "@tauri-apps/api/event";
import {
  type EventPayload as FrontendEventPayload,
  EventType as FrontendEventType,
} from "../../types/events";
import { useGlobalModal } from "../../hooks/useGlobalModal";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { openExternalUrl } from "../../services/tauri-service";

export default function ChildProtectionModal() {
  const { t } = useTranslation();
  const { showModal, hideModal } = useGlobalModal();

  useEffect(() => {
    const unlisten = listen<FrontendEventPayload>("state_event", (event: TauriEvent<FrontendEventPayload>) => {
      try {
        if (event.payload.event_type === FrontendEventType.Error && event.payload.error) {
          const errorText = event.payload.error.toLowerCase();

          // Detect the child-protection / InsufficientPrivileges case conservatively
          if (
            errorText.includes("child protection") ||
            errorText.includes("insufficientprivilegesexception") ||
            errorText.includes("/session/minecraft/join")
          ) {
            // Async flow to check active account and show modal
            (async () => {
              try {
                showModal(
                  "child-protection-modal",
                  <Modal
                    title={t('child_protection.title')}
                    onClose={async () => {
                      hideModal("child-protection-modal");
                    }}
                    width="xl"
                    variant="flat"
                  >
                    <div className="p-4">
                      <p className="text-white/90 mb-6 text-center font-minecraft-ten">
                        {t('child_protection.description')}
                      </p>
                      <p className="text-white/90 mb-6 text-center font-minecraft-ten">
                        {t('child_protection.review_settings')}
                      </p>
                      <p className="text-white/90 mb-6 text-center font-minecraft-ten">
                        {t('child_protection.setting_location')}
                      </p>
                      <div className="flex justify-center gap-4">
                        <Button
                          variant="secondary"
                          size="md"
                          onClick={() => hideModal("child-protection-modal")}
                        >
                          {t('child_protection.button.ignore')}
                        </Button>
                        <Button
                          onClick={() => openExternalUrl(`https://www.xbox.com/user/settings/privacy-and-safety?gamertag=${event.payload.message}&activetab=main:privilegetab`)}
                          variant="info"
                          size="md"
                        >
                          {t('child_protection.button.open_settings')}
                        </Button>
                      </div>
                    </div>
                  </Modal>,
                );
              } catch (e) {
                console.error("Failed to handle child-protection modal logic:", e);
              }
            })();
          }
        }
      } catch (e) {
        console.error("Error handling state_event in ChildProtectionModal:", e);
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
    // showModal/hideModal are stable from hook; t is stable from i18next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
