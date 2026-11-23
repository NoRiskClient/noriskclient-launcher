import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/buttons/Button";
import { SupportRequestService } from "../../services/support-request-service";
import { NoProfileStep, Spinner, Status, SupportFrame, type StepFlow } from "./parts";
import type { PreparedItems } from "./usePreparedItems";

export function DoneStep({
  flow,
  items,
  sent,
  profileMissing,
}: {
  flow: StepFlow;
  items: PreparedItems;
  sent: boolean;
  profileMissing: boolean;
}) {
  const { t } = useTranslation();
  const [reported, setReported] = useState(sent);
  const [attempt, setAttempt] = useState(0);
  const started = useRef<number | null>(sent ? 0 : null);
  const name = flow.info.requestedBy.displayName;
  const { prepared, preparing, selection } = items;
  const { code, showError, close } = flow;

  useEffect(() => {
    if (started.current === attempt || !prepared || preparing) return;
    started.current = attempt;
    SupportRequestService.submit(code, selection)
      .then(() => setReported(true))
      .catch((e) => showError(e, () => setAttempt((n) => n + 1)));
  }, [code, prepared, preparing, selection, showError, attempt]);

  if (profileMissing) return <NoProfileStep flow={flow} />;

  if (!reported) {
    return (
      <SupportFrame onClose={flow.close} busy stepper={flow.stepper}>
        <Spinner text={t("support_request.send.sending")} />
      </SupportFrame>
    );
  }

  return (
    <SupportFrame
      onClose={flow.close}
      stepper={flow.stepper}
      right={
        <Button variant="default" size="lg" onClick={flow.close}>
          {t("support_request.close")}
        </Button>
      }
    >
      <Status
        centered
        icon="solar:check-circle-bold"
        tone="good"
        title={t("support_request.done.title")}
        text={t(sent ? "support_request.done.text" : "support_request.done.reported", { name })}
      />
    </SupportFrame>
  );
}
