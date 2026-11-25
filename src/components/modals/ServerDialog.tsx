import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { Modal } from "../ui/Modal";
import { SearchStyleInput } from "../ui/Input";
import { FieldLabel } from "../ui/SegmentedControl";
import { Button } from "../ui/buttons/Button";
import { PLAIN_TEXT } from "../ui/typography";
import { pingMinecraftServer } from "../../services/world-service";
import { McServerRow, type ServerPingState } from "../profiles/v3/shared/McServerRow";

const PREVIEW_DELAY_MS = 500;

interface ServerDialogProps {
  initialName?: string;
  initialAddress?: string;
  onClose: () => void;
  onSave: (name: string, address: string) => Promise<void>;
}

export function ServerDialog({
  initialName = "",
  initialAddress = "",
  onClose,
  onSave,
}: ServerDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState(initialAddress);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<ServerPingState>(undefined);
  const target = address.trim();

  useEffect(() => {
    if (!target) {
      setPreview(undefined);
      return;
    }
    let current = true;
    setPreview("pending");
    const timer = window.setTimeout(() => {
      pingMinecraftServer(target)
        .then((info) => current && setPreview(info))
        .catch(() => current && setPreview("error"));
    }, PREVIEW_DELAY_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [target]);
  const editing = initialAddress !== "";
  const canSave = address.trim() !== "" && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(name, address);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t(
        editing
          ? "profiles.v3.servers.editTitle"
          : "profiles.v3.servers.addTitle",
      )}
      titleIcon={<Icon icon="solar:server-bold" className="w-5 h-5" />}
      titleClassName={PLAIN_TEXT}
      onClose={onClose}
      width="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            className={PLAIN_TEXT}
            onClick={onClose}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="flat"
            size="sm"
            className={PLAIN_TEXT}
            disabled={!canSave}
            onClick={save}
          >
            {t(editing ? "common.save" : "profiles.v3.servers.add")}
          </Button>
        </div>
      }
    >
      <form
        className="p-6 space-y-5 font-minecraft normal-case"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <McServerRow name={name.trim() || t("profiles.v3.servers.defaultName")} pingState={preview} className="p-1 bg-black/60" />
        <div className="space-y-2">
          <FieldLabel>{t("profiles.v3.servers.addressLabel")}</FieldLabel>
          <SearchStyleInput
            icon="solar:server-bold"
            value={address}
            placeholder="play.example.com"
            onChange={(e) => setAddress(e.target.value)}
            autoFocus
            className="text-sm normal-case"
          />
        </div>
        <div className="space-y-2">
          <FieldLabel>{t("profiles.v3.servers.nameLabel")}</FieldLabel>
          <SearchStyleInput
            icon="solar:tag-bold"
            value={name}
            placeholder={t("profiles.v3.servers.namePlaceholder")}
            onChange={(e) => setName(e.target.value)}
            className="text-sm normal-case"
          />
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
