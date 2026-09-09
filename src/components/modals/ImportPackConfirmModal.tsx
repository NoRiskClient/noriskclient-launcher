"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { SearchStyleInput } from "../ui/Input";
import { Checkbox } from "../ui/Checkbox";
import { GroupPicker } from "../ui/GroupPicker";
import { ImportPreviewChips } from "../profiles/import/ImportPreviewChips";
import {
  ImportSecurityPanel,
  ImportTrustWarning,
} from "../profiles/import/ImportSecurityPanel";
import { ImportRemovedList } from "../profiles/import/ImportRemovedList";
import { useImportConfirmStore } from "../../store/import-confirm-store";
import { useKnownProfileGroups } from "../../hooks/useKnownProfileGroups";
import { runPackImport } from "../../utils/pack-import";

export function ImportPackConfirmModal() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isOpen, isLoading, preview, filePath, close } = useImportConfirmStore();
  const [isImporting, setIsImporting] = useState(false);
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [useNoriskPack, setUseNoriskPack] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setName("");
      setGroup("");
      return;
    }
    if (preview) {
      setName(preview.profileName ?? "");
      setGroup(preview.group ?? "");
      setUseNoriskPack(preview.noriskPack.preselected);
    }
  }, [isOpen, preview]);

  const knownGroups = useKnownProfileGroups([preview?.group]);

  if (!isOpen) return null;

  const trimmedName = name.trim();

  const handleConfirm = async () => {
    const target = preview?.filePath ?? filePath;
    if (!target || !trimmedName) return;

    setIsImporting(true);
    close();
    const newProfileId = await runPackImport(target, {
      name: trimmedName,
      group: group.trim(),
      noriskPackId: useNoriskPack ? preview?.noriskPack.packId : undefined,
      clearNoriskPack: !useNoriskPack,
    });
    setIsImporting(false);
    if (newProfileId) {
      navigate(`/profilesv2/${newProfileId}`);
    }
  };

  const renderFooter = () => (
    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
      <Button variant="secondary" onClick={close} size="md" disabled={isImporting}>
        {t("common.cancel")}
      </Button>
      <Button
        variant="default"
        onClick={handleConfirm}
        size="md"
        disabled={isLoading || isImporting || !trimmedName}
        icon={<Icon icon="solar:download-bold" className="w-5 h-5 text-white" />}
      >
        {t("profiles.import.confirm")}
      </Button>
    </div>
  );

  return (
    <Modal
      title={t("profiles.import.review_title")}
      titleSubtitle={
        preview ? (
          <ImportPreviewChips
            leadLabel={preview.fileName}
            gameVersion={preview.gameVersion}
            loader={preview.loader}
            modCount={preview.modCount}
            sizeBytes={preview.fileSize}
          />
        ) : undefined
      }
      onClose={close}
      width="lg"
      footer={renderFooter()}
    >
      <div className="p-6 space-y-5">
        {isLoading || !preview ? (
          <div className="flex items-center gap-3 text-white/70 font-minecraft tracking-wide">
            <Icon icon="svg-spinners:ring-resize" className="w-5 h-5" />
            <span>{t("profiles.import.reading_pack")}</span>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div className="flex flex-col">
                <label className="block text-lg font-smallcaps text-white mb-2">
                  {t("profiles.import.field_name")}
                </label>
                <SearchStyleInput
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("profiles.import.field_name_placeholder")}
                  className="text-sm w-full"
                />
              </div>

              <div className="flex flex-col">
                <label className="block text-lg font-smallcaps text-white mb-2">
                  {t("profiles.import.field_group")}
                </label>
                <GroupPicker value={group} onChange={setGroup} options={knownGroups} />
              </div>
            </div>

            <Checkbox
              label={t("profiles.import.norisk_toggle_title")}
              checked={useNoriskPack}
              onChange={(event) => setUseNoriskPack(event.target.checked)}
              size="lg"
            />

            <ImportTrustWarning />

            <ImportSecurityPanel
              security={preview.security}
              provenance={preview.provenance}
              executableContent={preview.executableContent}
            />

            <ImportRemovedList security={preview.security} />
          </>
        )}
      </div>
    </Modal>
  );
}
