"use client";

import { useSettingsModalStore } from "../../store/settings-modal-store";
import { SettingsTab } from "../tabs/SettingsTab";

export function SettingsModal() {
  const { isOpen, close } = useSettingsModalStore();

  if (!isOpen) {
    return null;
  }

  return <SettingsTab onClose={close} />;
}
