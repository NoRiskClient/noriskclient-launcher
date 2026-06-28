"use client";

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { useThemeStore } from "../../store/useThemeStore";
import { IconButton } from "../ui/buttons/IconButton";
import { Button } from "../ui/buttons/Button";
import { openExternalUrl } from "../../services/tauri-service";

interface CreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreditsModal({ isOpen, onClose }: CreditsModalProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);
  
  if (!isOpen) return null;

  const handleOpenUrl = async (url: string) => {
    try {
      await openExternalUrl(url);
    } catch (error) {
      console.error("Failed to open external URL:", error);
    }
  };

  return (
    <Modal
      title={t('credits_modal.title')}
      titleIcon={<Icon icon="solar:code-bold" className="w-6 h-6" />}
      onClose={onClose}
      width="md"
    >
      <div className="p-6">
        <div className="space-y-6">
          <div className="flex items-center justify-between p-4 rounded-lg bg-black/20 border-2 border-white/20 transition-colors">
            <div className="flex items-center gap-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: `${accentColor.value}40` }}
              >
                <Icon
                  icon="solar:code-2-bold"
                  className="w-5 h-5"
                  style={{ color: accentColor.value }}
                />
              </div>
              <div className="min-h-[3rem] flex flex-col justify-center">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-minecraft text-white lowercase tracking-wider">
                    Deadmake
                  </span>
                  <span className="text-white/50 font-minecraft text-lg lowercase">
                    aka Maggus
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right mr-3">
                <p className="text-white/80 font-minecraft text-lg lowercase tracking-wide">
                  {t('credits_modal.ui_frontend')}
                </p>
              </div>
              <IconButton
                icon={<Icon icon="solar:global-bold" className="w-4 h-4" />}
                onClick={() => handleOpenUrl("https://deadmake.dev")}
                variant="default"
                size="sm"
                title="Visit deadmake.dev"
              />
              <IconButton
                icon={<span className="text-sm" style={{ transform: "translateY(2px)"}}>🍋</span>}
                onClick={() => handleOpenUrl("https://fruity.dev")}
                variant="default"
                size="sm"
                title="Visit fruity.dev"
              />
            </div>
          </div>
            <div className="flex items-center justify-between p-4 rounded-lg bg-black/20 border-2 border-white/20 transition-colors">
            <div className="flex items-center gap-4">
              <div 
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ backgroundColor: `${accentColor.value}40` }}
              >
                <Icon
                  icon="solar:server-bold"
                  className="w-5 h-5"
                  style={{ color: accentColor.value }}
                />
              </div>
              <div className="min-h-[3rem] flex flex-col justify-center">
                <div className="flex items-baseline gap-2">
                  <h4 className="text-2xl font-minecraft text-white lowercase tracking-wider">
                    NoRisk
                  </h4>
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-white/80 font-minecraft text-lg lowercase tracking-wide">
                {t('credits_modal.backend_core')}
              </p>
            </div>
          </div>

          {/* Open Source Licenses Button */}
          <div className="flex justify-center pt-4">
            <Button
              variant="ghost"
              className="flex items-center gap-2 px-6 py-3 border border-[#ffffff20] hover:bg-white/5 transition-colors"
              onClick={() => handleOpenUrl("https://norisk.gg/licenses")}
            >
              <Icon icon="solar:external-link-bold" className="w-5 h-5" />
              <span className="font-minecraft text-lg lowercase">{t('credits_modal.view_licenses')}</span>
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
