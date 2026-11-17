import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { Icon } from "@iconify/react";
import { useThemeStore } from "../../store/useThemeStore";
import { useTranslation } from "react-i18next";

interface CapeGuidelinesModalProps {
  onAccept: () => void;
  onClose: () => void;
}

export function CapeGuidelinesModal({ onAccept, onClose }: CapeGuidelinesModalProps) {
  const { t } = useTranslation();
  const { acceptCapeGuidelines } = useThemeStore();

  const handleAccept = () => {
    acceptCapeGuidelines();
    onAccept();
  };

  return (
    <Modal
      title={t("capes.guidelines.title")}
      titleIcon={<Icon icon="solar:shield-warning-bold" className="w-7 h-7 text-yellow-400" />}
      onClose={() => {}}
      width="lg"
      closeOnClickOutside={false}
      footer={
        <div className="flex justify-end">
          <Button
            onClick={handleAccept}
            variant="default"
            icon={<Icon icon="solar:check-circle-bold" className="w-5 h-5" />}
          >
            {t("capes.guidelines.accept")}
          </Button>
        </div>
      }
    >
      <div className="p-6 space-y-6 text-white">
        <div className="text-center space-y-4">
          <h3 className="text-lg font-smallcaps text-yellow-400">
            {t("capes.guidelines.before_upload")}
          </h3>
          <p className="text-lg font-minecraft text-gray-300">
            {t("capes.guidelines.intro")}
          </p>
        </div>

        <div className="space-y-4 text-base font-minecraft text-gray-200 p-4 bg-black/30 rounded border border-gray-600">
          <ul className="space-y-3 list-disc list-inside text-sm">
            <li>
              {t("capes.guidelines.no_copyright")}
              <span className="block ml-6 text-gray-400 text-xs mt-1">
                {t("capes.guidelines.no_copyright_hint")}
              </span>
            </li>
            <li>{t("capes.guidelines.no_explicit")}</li>
            <li>{t("capes.guidelines.no_discrimination")}</li>
            <li>{t("capes.guidelines.no_political")}</li>
          </ul>

          <div className="pt-3 border-t border-gray-600">
            <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-500/30 rounded-md">
              <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">
                {t("capes.guidelines.violation_warning")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
