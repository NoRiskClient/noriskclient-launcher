"use client";

import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { useThemeStore } from "../../store/useThemeStore";
import type { SyncPreviewEntry } from "../../types/syncPacks";

export interface AdoptPreviewModalProps {
  profileName: string;
  packName: string;
  entries: SyncPreviewEntry[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function AdoptPreviewModal({
  profileName,
  packName,
  entries,
  busy,
  onCancel,
  onConfirm,
}: AdoptPreviewModalProps) {
  const { t } = useTranslation();
  const accentColor = useThemeStore((state) => state.accentColor);

  const totalMoves = entries.reduce((sum, entry) => sum + entry.moves, 0);
  const totalCollisions = entries.reduce(
    (sum, entry) => sum + entry.collisions,
    0,
  );

  return (
    <Modal
      title={t("syncPacks.adoptDialog.title")}
      titleSubtitle={
        <span className="font-minecraft text-xs normal-case text-white/45">
          {t("syncPacks.adoptDialog.intro", {
            profile: profileName,
            pack: packName,
          })}
        </span>
      }
      onClose={onCancel}
      width="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="md" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="warning" size="md" onClick={onConfirm} disabled={busy}>
            {t("syncPacks.adoptDialog.confirm")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 px-8 pb-6 pt-5">
        <div className="overflow-hidden rounded-lg border border-white/10">
          {entries.map((entry) => (
            <div
              key={`${entry.pack_id}:${entry.target_path}`}
              className="flex items-center gap-4 border-b border-white/[0.06] px-5 py-3.5 last:border-b-0"
            >
              <Icon
                icon="solar:folder-bold"
                className="h-5 w-5 flex-shrink-0"
                style={{ color: accentColor.value }}
              />

              <span className="min-w-0 flex-1 truncate font-minecraft text-base text-white/90">
                {entry.target_path}
              </span>

              <div className="flex flex-shrink-0 items-center gap-4 font-minecraft text-sm">
                {entry.moves > 0 && (
                  <span className="text-white/60">
                    {t("syncPacks.adoptDialog.moves", { count: entry.moves })}
                  </span>
                )}
                {entry.collisions > 0 && (
                  <span className="text-amber-300/80">
                    {t("syncPacks.adoptDialog.collisions", {
                      count: entry.collisions,
                    })}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-5 py-4">
          <Icon
            icon="solar:info-circle-bold"
            className="mt-0.5 h-5 w-5 flex-shrink-0 text-white/30"
          />
          <div className="font-minecraft text-sm leading-relaxed text-white/45">
            {totalMoves > 0 && (
              <div>{t("syncPacks.adoptDialog.explainMoves")}</div>
            )}
            {totalCollisions > 0 && (
              <div className="mt-1">
                {t("syncPacks.adoptDialog.explainCollisions")}
              </div>
            )}
            <div className="mt-1 text-white/30">
              {t("syncPacks.adoptDialog.explainSafe")}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default AdoptPreviewModal;
