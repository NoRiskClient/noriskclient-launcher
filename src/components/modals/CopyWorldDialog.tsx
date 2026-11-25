import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { FieldLabel } from "../ui/SegmentedControl";
import { PLAIN_TEXT } from "../ui/typography";
import { ProfilePickerGrid } from "../profiles/ProfilePickerGrid";
import { McWorldRow } from "../profiles/v3/shared/McWorldRow";
import { useProfileStore } from "../../store/profile-store";
import { sortRecentFirst } from "../../utils/profile-sort";
import type { Profile } from "../../types/profile";
import type { WorldInfo } from "../../types/minecraft";

interface CopyWorldDialogProps {
  worlds: WorldInfo[];
  availableProfiles: Profile[];
  isLoadingProfiles: boolean;
  onClose: () => void;
  onConfirm: (params: { targetProfileIds: string[]; copies: WorldCopy[] }) => Promise<void>;
}

export interface WorldCopy {
  world: WorldInfo;
  name: string;
}

const nameOf = (world: WorldInfo) => world.display_name ?? world.folder_name;

export function CopyWorldDialog({
  worlds,
  availableProfiles,
  isLoadingProfiles,
  onClose,
  onConfirm,
}: CopyWorldDialogProps) {
  const { t } = useTranslation();
  const lastPlayedProfileId = useProfileStore((s) => s.lastPlayedProfileId);
  const profiles = useMemo(
    () => sortRecentFirst(availableProfiles, lastPlayedProfileId),
    [availableProfiles, lastPlayedProfileId],
  );
  const [targetIds, setTargetIds] = useState<Set<string>>(() => new Set());
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(worlds.map((world) => [world.folder_name, nameOf(world)])),
  );
  const [copying, setCopying] = useState(false);
  const copies = worlds.map((world) => ({ world, name: (names[world.folder_name] ?? "").trim() }));
  const canCopy = targetIds.size > 0 && copies.every((copy) => copy.name !== "") && !copying && !isLoadingProfiles;

  const toggleTarget = (id: string) =>
    setTargetIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copy = async () => {
    if (!canCopy) return;
    setCopying(true);
    try {
      await onConfirm({ targetProfileIds: [...targetIds], copies });
    } finally {
      setCopying(false);
    }
  };

  return (
    <Modal
      title={worlds.length === 1 ? t("copy_world.title", { name: nameOf(worlds[0]) }) : t("copy_world.title_many", { count: worlds.length })}
      titleIcon={<Icon icon="solar:copy-bold" className="w-5 h-5" />}
      titleClassName={PLAIN_TEXT}
      onClose={onClose}
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" className={PLAIN_TEXT} onClick={onClose} disabled={copying}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="flat"
            size="sm"
            className={PLAIN_TEXT}
            disabled={!canCopy}
            onClick={copy}
            icon={copying ? <Icon icon="svg-spinners:ring-resize" className="w-4 h-4" /> : undefined}
          >
            {copying ? t("copy_world.button.copying") : t("copy_world.button.copy")}
          </Button>
        </div>
      }
    >
      <div className="p-6 space-y-5 font-minecraft normal-case">
        <div className="max-h-[232px] overflow-y-auto custom-scrollbar space-y-1">
          {worlds.map((world) => (
            <div key={world.folder_name} className="p-1 bg-black/40">
              <McWorldRow
                world={world}
                nameSlot={
                  worlds.length === 1 ? (
                    <input
                      value={names[world.folder_name] ?? ""}
                      onChange={(e) => setNames((current) => ({ ...current, [world.folder_name]: e.target.value }))}
                      placeholder={t("copy_world.enter_name_placeholder")}
                      disabled={copying}
                      autoFocus
                      spellCheck={false}
                      className="w-full -mx-1 px-1 rounded-sm bg-transparent hover:bg-white/5 focus:bg-white/10 text-white placeholder-white/30 outline-none transition-colors"
                    />
                  ) : undefined
                }
              />
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <FieldLabel>{t("copy_world.copy_to_profile")}</FieldLabel>
          {isLoadingProfiles ? (
            <div className="text-sm text-white/50">{t("copy_world.loading_profiles")}</div>
          ) : (
            <ProfilePickerGrid
              profiles={profiles}
              lastPlayedProfileId={lastPlayedProfileId}
              selectedIds={targetIds}
              onSelect={(profile) => toggleTarget(profile.id)}
              disabled={copying}
              listClassName="max-h-[260px]"
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
