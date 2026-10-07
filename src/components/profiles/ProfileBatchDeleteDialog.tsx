import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { toast } from "react-hot-toast";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/buttons/Button";
import { parseErrorMessage } from "../../utils/error-utils";

interface ProfileBatchDeleteDialogProps {
  itemName: string;
  title: string;
  message: ReactNode;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/** Own pending state here: global-modal elements do not receive parent re-renders. */
export function ProfileBatchDeleteDialog({
  itemName, title, message, onClose, onConfirm,
}: ProfileBatchDeleteDialogProps) {
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);
  const deletingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleClose = () => {
    if (!deletingRef.current) onClose();
  };
  const handleConfirm = async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setIsDeleting(true);
    try {
      await onConfirm();
    } catch (error) {
      toast.error(t("content_manager.errors.batch_delete_failed", { errors: parseErrorMessage(error) }));
    } finally {
      deletingRef.current = false;
      if (mountedRef.current) setIsDeleting(false);
    }
  };

  return (
    <Modal
      title={title || t("confirm_delete.title", { name: itemName })}
      titleIcon={<Icon icon="solar:trash-bin-trash-bold-duotone" className="w-6 h-6 text-red-400" />}
      onClose={handleClose}
      closeOnClickOutside={!isDeleting}
      closeOnEscape={!isDeleting}
      hideCloseButton={isDeleting}
      width="sm"
      footer={
        <div className="flex justify-end items-center gap-3">
          <Button variant="secondary" onClick={handleClose} disabled={isDeleting}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isDeleting}
            icon={isDeleting ? <Icon icon="svg-spinners:ring-resize" className="h-4 w-4" /> : null}
          >
            {isDeleting ? t("confirm_delete.button.deleting") : t("confirm_delete.button.delete")}
          </Button>
        </div>
      }
    >
      <div className="p-6">{message}</div>
    </Modal>
  );
}
