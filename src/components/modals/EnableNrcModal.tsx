"use client";

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { useEnableNrcStore } from "../../store/enable-nrc-store";
import { useProfileStore } from "../../store/profile-store";

export function EnableNrcModal() {
  const { t } = useTranslation();
  const { pendingProfileId, closeModal } = useEnableNrcStore();
  const { updateProfile } = useProfileStore();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  if (!pendingProfileId) {
    return null;
  }

  const handleEnable = async () => {
    try {
      setIsLoading(true);
      await updateProfile(pendingProfileId, {
        selected_norisk_pack_id: "norisk-prod",
      });
      toast.success(t("enable_nrc.toast.enabled"));
    } catch (err) {
      console.error("Failed to enable NRC:", err);
      toast.error(t("enable_nrc.toast.failed"));
    } finally {
      setIsLoading(false);
      closeModal();
      navigate(`/profilesv2/${pendingProfileId}`);
    }
  };

  const handleSkip = () => {
    closeModal();
    navigate(`/profilesv2/${pendingProfileId}`);
  };

  return (
    <Modal
      title={t("enable_nrc.title")}
      onClose={handleSkip}
      width="md"
      footer={
        <div className="flex justify-between">
          <Button
            variant="secondary"
            onClick={handleSkip}
            size="md"
            className="text-2xl"
            disabled={isLoading}
          >
            {t("enable_nrc.skip")}
          </Button>
          <Button
            variant="default"
            onClick={handleEnable}
            disabled={isLoading}
            size="md"
            className="text-2xl"
          >
            {isLoading ? (
              <div className="flex items-center gap-3">
                <Icon
                  icon="solar:refresh-bold"
                  className="w-6 h-6 animate-spin text-white"
                />
                <span>{t("enable_nrc.enabling")}</span>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Icon icon="solar:shield-check-bold" className="w-6 h-6 text-white" />
                <span>{t("enable_nrc.enable")}</span>
              </div>
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-6 p-6">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <Icon
              icon="solar:shield-warning-bold"
              className="w-16 h-16 text-amber-400"
            />
          </div>
          <p className="text-2xl font-minecraft text-white/80 mb-4 lowercase">
            {t("enable_nrc.description")}
          </p>
          <p className="text-xs text-white/60 font-minecraft-ten tracking-wide">
            {t("enable_nrc.hint")}
          </p>
        </div>
      </div>
    </Modal>
  );
}
