"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/buttons/Button";
import { useGlobalModalStore } from "../../hooks/useGlobalModal";
import { SupportRequestService } from "../../services/support-request-service";
import { DataStep } from "./DataStep";
import { ErrorStep } from "./ErrorStep";
import { FixStep } from "./FixStep";
import { HelloStep } from "./HelloStep";
import { Spinner, Status, SupportFrame, type StepFlow } from "./parts";
import { ProfileStep } from "./ProfileStep";
import { getSupportItemDefinition } from "./supportItems";
import { usePreparedItems } from "./usePreparedItems";
import { useSupportProfiles } from "./useSupportProfiles";
import { useSupportRequest } from "./useSupportRequest";

const SUPPORT_REQUEST_MODAL_ID = "support-request";

export function openSupportRequestDialog(code: string | undefined) {
  if (typeof code !== "string" || code.trim() === "") return;
  const { openModal, closeModal } = useGlobalModalStore.getState();
  openModal(
    SUPPORT_REQUEST_MODAL_ID,
    <SupportRequestDialog
      key={`${code}:${Date.now()}`}
      code={code}
      onClose={() => closeModal(SUPPORT_REQUEST_MODAL_ID)}
    />,
  );
}

type Step = "hello" | "profile" | "fix" | "data" | "done";

const LOADING_DELAY_MS = 300;

function SupportRequestDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const { t } = useTranslation();
  const request = useSupportRequest(code);
  const profiles = useSupportProfiles();
  const [step, setStep] = useState<Step>("hello");
  const [actionCursor, setActionCursor] = useState(0);
  const [slow, setSlow] = useState(false);
  const items = usePreparedItems({
    code,
    accountId: request.info?.account.id,
    profileId: profiles.profileId,
    active: step === "fix" || step === "data",
    showError: request.showError,
  });

  const close = () => {
    void SupportRequestService.close(code);
    onClose();
  };

  const multiProfile = profiles.sorted.length > 1;
  const hasFixStep =
    !!profiles.profileId &&
    (items.prepared
      ? items.runnableActions.length > 0
      : !!request.info?.items.some((i) => getSupportItemDefinition(i.type)?.group === "action"));
  const steps: Step[] = ["hello", ...(multiProfile ? ["profile" as const] : []), ...(hasFixStep ? ["fix" as const] : []), "data"];
  const lastAction = Math.max(0, items.runnableActions.length - 1);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), LOADING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (step === "fix" && items.prepared && !items.preparing && items.runnableActions.length === 0) setStep("data");
  }, [step, items.prepared, items.preparing, items.runnableActions.length]);

  const goToFix = (cursor: number) => {
    setActionCursor(cursor);
    setStep("fix");
  };
  const afterProfile = () => (hasFixStep ? goToFix(0) : setStep("data"));
  const beforeFix = () => setStep(multiProfile ? "profile" : "hello");

  if (request.error) {
    return (
      <ErrorStep
        error={request.error}
        close={close}
        reload={() => openSupportRequestDialog(code)}
        dismiss={() => request.setError(null)}
        tryOtherAccounts={request.tryOtherAccounts}
      />
    );
  }

  if (!request.info) {
    if (!slow) return null;
    return (
      <SupportFrame onClose={close}>
        <Spinner text={t("support_request.loading")} />
      </SupportFrame>
    );
  }

  const name = request.info.requestedBy.displayName;
  const flow = (next: () => void, back: () => void): StepFlow => ({
    code,
    info: request.info!,
    stepper: { count: steps.length, current: steps.indexOf(step) },
    close,
    next,
    back,
    showError: request.showError,
  });

  switch (step) {
    case "hello":
      return (
        <HelloStep
          flow={flow(() => (multiProfile ? setStep("profile") : afterProfile()), () => {})}
          profilesReady={profiles.ready}
        />
      );
    case "profile":
      return (
        <ProfileStep
          flow={flow(afterProfile, () => setStep("hello"))}
          profiles={profiles}
          locked={items.actionsTouched}
        />
      );
    case "fix":
      return (
        <FixStep
          flow={flow(
            () => (actionCursor < lastAction ? setActionCursor((c) => c + 1) : setStep("data")),
            () => (actionCursor > 0 ? setActionCursor((c) => c - 1) : beforeFix()),
          )}
          items={items}
          cursor={actionCursor}
          profile={profiles.profile}
        />
      );
    case "data":
      return (
        <DataStep
          flow={flow(() => {}, () => (hasFixStep ? goToFix(lastAction) : beforeFix()))}
          items={items}
          profile={profiles.profile}
          profilesReady={profiles.ready}
          onSent={() => setStep("done")}
        />
      );
    case "done":
      return (
        <SupportFrame
          onClose={close}
          stepper={{ count: steps.length, current: steps.length }}
          right={
            <Button variant="default" size="lg" onClick={close}>
              {t("support_request.close")}
            </Button>
          }
        >
          <Status
            centered
            icon="solar:check-circle-bold"
            tone="good"
            title={t("support_request.done.title")}
            text={t("support_request.done.text", { name })}
          />
        </SupportFrame>
      );
  }
}
