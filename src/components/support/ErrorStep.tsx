"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/buttons/Button";
import { useClickGuard } from "../../hooks/useClickGuard";
import { useSocialsModalStore } from "../../store/socials-modal-store";
import { LoginButton, Status, SupportFrame, TextLink } from "./parts";
import type { ErrorState } from "./useSupportRequest";

export function ErrorStep({
  error,
  close,
  reload,
  dismiss,
  tryOtherAccounts,
}: {
  error: ErrorState;
  close: () => void;
  reload: () => void;
  dismiss: () => void;
  tryOtherAccounts: () => void;
}) {
  const { t } = useTranslation();
  const armed = useClickGuard(error.kind);
  const bigButton = (label: string, onClick: () => void, disabled = false) => (
    <Button variant="default" size="lg" onClick={onClick} disabled={disabled}>
      {label}
    </Button>
  );

  let left: ReactNode = null;
  let right: ReactNode;
  if (error.kind === "not_logged_in") {
    left = <TextLink onClick={reload}>{t("support_request.retry")}</TextLink>;
    right = <LoginButton />;
  } else if (error.kind === "discord_not_linked") {
    right = bigButton(t("support_request.error.discord_button"), () => {
      close();
      useSocialsModalStore.getState().openModal();
    });
  } else if (error.otherAccounts) {
    left = <TextLink onClick={close}>{t("support_request.close")}</TextLink>;
    right = bigButton(t("support_request.error.other_account_button"), tryOtherAccounts, !armed);
  } else if (error.retry) {
    const retry = error.retry;
    right = bigButton(t("support_request.retry"), () => {
      dismiss();
      retry();
    });
  } else {
    right = (
      <Button variant="secondary" size="lg" onClick={close}>
        {t("support_request.close")}
      </Button>
    );
  }

  return (
    <SupportFrame onClose={close} left={left} right={right}>
      <Status
        icon="solar:danger-circle-bold"
        tone="bad"
        title={t("support_request.error.title")}
        text={t(`support_request.error.${error.kind}`)}
      />
    </SupportFrame>
  );
}
