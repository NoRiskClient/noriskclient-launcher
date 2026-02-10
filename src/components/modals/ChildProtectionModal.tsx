"use client";

import { useEffect } from "react";
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
                    title="Microsoft Account Restriction"
                    onClose={async () => {
                      hideModal("child-protection-modal");
                    }}
                    width="xl"
                    variant="flat"
                  >
                    <div className="p-4">
                      <p className="text-white/90 mb-6 text-center font-minecraft-ten">
                        It looks like your Microsoft account has a child protection or privacy mode enabled that restricts multiplayer functionality. Because of this the launcher cannot complete the login step.
                      </p>
                      <p className="text-white/90 mb-6 text-center font-minecraft-ten">
                        Please review your Microsoft / Xbox account parental controls or family settings and ensure multiplayer access is allowed, then try logging in again.
                      </p>
                      <p className="text-white/90 mb-6 text-center font-minecraft-ten">
                        The setting you are looking for can be found on the Xbox website under "Privacy & Online Safety" → "Online Safety" → "You can join multiplayer games" → "Allow".
                      </p>
                      <div className="flex justify-center gap-4">
                        <Button
                          variant="secondary"
                          size="md"
                          onClick={() => hideModal("child-protection-modal")}
                        >
                          Ignore
                        </Button>
                        <Button
                          onClick={() => openExternalUrl(`https://www.xbox.com/user/settings/privacy-and-safety?gamertag=${event.payload.message}&activetab=main:privilegetab`)}
                          variant="info"
                          size="md"
                        >
                          Open Microsoft Account Settings
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
    // showModal/hideModal are stable from hook; keep empty deps to only register once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
