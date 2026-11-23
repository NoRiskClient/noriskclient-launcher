import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/buttons/Button";
import { ExportFileSelector } from "../profiles/settings/ExportFileSelector";
import { useClickGuard } from "../../hooks/useClickGuard";
import { SupportRequestService } from "../../services/support-request-service";
import { exportStepText, useExportProgress } from "../../hooks/useExportProgress";
import type { ExportStep } from "../../types/events";
import type { Profile } from "../../types/profile";
import { BackButton, CollectingProgress, NoProfileStep, ProgressBar, SMALL_SPINNER, Status, SupportFrame, TextLink, type StepFlow } from "./parts";
import type { PreparedItems } from "./usePreparedItems";

function requestedPaths(preview: string | null | undefined): string[] {
  try {
    return (JSON.parse(preview ?? "{}") as { requested?: string[] }).requested ?? [];
  } catch {
    return [];
  }
}

type Phase = "choose" | "sharing" | "submitting" | "shared" | "failed" | "too_large";

const PERSONAL_PATH = /(^|[\/])(saves|screenshots)([\/]|$)|servers\.dat$/i;

const STARTING: ExportStep = { phase: "collecting", done: 0, total: 0, file: null };
const CHECKING: ExportStep = { phase: "checking", done: 0, total: 0, file: null };

const PHASE_ICON: Record<ExportStep["phase"], string> = {
  collecting: "solar:folder-with-files-bold",
  uploading: "solar:cloud-upload-bold",
  checking: "solar:shield-check-bold",
};

function ShareProgress({ step, percent }: { step: ExportStep; percent: number | null }) {
  const { t } = useTranslation();
  const detail = step.phase === "collecting" ? step.file : step.phase === "uploading" ? exportStepText(t, step) : null;
  const count = step.phase === "collecting" && step.total > 0 ? `${step.done} / ${step.total}` : null;
  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <Icon icon={PHASE_ICON[step.phase]} className="w-14 h-14 text-white/80" />
      <span className="font-minecraft text-lg tracking-wide text-white/80">{t(`support_request.share.phase.${step.phase}`)}</span>
      <div className="w-full max-w-xs space-y-2">
        <ProgressBar percent={percent} />
        <div className="flex items-center justify-between gap-3 font-minecraft text-sm tracking-wide text-white/60">
          <span className="truncate">{detail ?? " "}</span>
          <span className="shrink-0 tabular-nums">{count ?? (percent === null ? "" : `${percent}%`)}</span>
        </div>
      </div>
    </div>
  );
}

export function ShareProfileStep({
  flow,
  items,
  profile,
  profileMissing,
  onSent,
}: {
  flow: StepFlow;
  items: PreparedItems;
  profile: Profile | null;
  profileMissing: boolean;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const { shareItem, preparing, prepared } = items;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState(false);
  const [phase, setPhase] = useState<Phase>("choose");
  const [step, setStep] = useState<ExportStep>(STARTING);
  const [percent, setPercent] = useState<number | null>(null);
  const [reason, setReason] = useState("unknown");
  const [loadingFiles, setLoadingFiles] = useState(true);
  const armed = useClickGuard(phase);
  const name = flow.info.requestedBy.displayName;
  const profileId = profile?.id;
  const preview = shareItem?.preview;
  const only = useMemo(() => requestedPaths(preview), [preview]);

  useExportProgress(
    profileId,
    (next, progress) => {
      setStep(next);
      setPercent(progress);
    },
    phase === "sharing",
  );

  const personal = [...selected].some((path) => PERSONAL_PATH.test(path));

  const submit = async () => {
    if (!shareItem) return;
    setPhase("submitting");
    setStep(CHECKING);
    setPercent(null);
    try {
      await SupportRequestService.submit(flow.code, [shareItem.index]);
      onSent();
    } catch (e) {
      setPhase("shared");
      flow.showError(e);
    }
  };

  const share = async () => {
    if (!shareItem || phase === "sharing") return;
    setPhase("sharing");
    setStep(STARTING);
    setPercent(null);
    try {
      const result = await SupportRequestService.shareProfile(flow.code, shareItem.index, { paths: [...selected] });
      if (result.status !== "DONE") {
        setReason(result.message ?? "unknown");
        const tooLarge = result.message === "too_large";
        setPhase(tooLarge ? "too_large" : "failed");
        setDetails(tooLarge);
        return;
      }
      await submit();
    } catch (e) {
      setPhase("failed");
      flow.showError(e);
    }
  };

  if (profileMissing) return <NoProfileStep flow={flow} />;

  if (preparing || !prepared || !profile) {
    return (
      <SupportFrame onClose={flow.close} stepper={flow.stepper} left={<BackButton onClick={flow.back} disabled />}>
        <CollectingProgress />
      </SupportFrame>
    );
  }

  if (!shareItem || shareItem.error) {
    return (
      <SupportFrame onClose={flow.close} stepper={flow.stepper} left={<BackButton onClick={flow.back} />}>
        <Status icon="solar:danger-triangle-bold" tone="bad" title={t("support_request.share.failed")} />
      </SupportFrame>
    );
  }

  const busy = phase === "sharing" || phase === "submitting";
  const right =
    phase === "failed" || phase === "too_large" ? (
      <Button variant="default" size="lg" onClick={share} disabled={!armed}>
        {t("support_request.retry")}
      </Button>
    ) : phase === "shared" ? (
      <Button variant="default" size="lg" onClick={submit} disabled={!armed}>
        {t("support_request.retry")}
      </Button>
    ) : (
      <Button variant="success" size="lg" onClick={share} disabled={busy || loadingFiles || !armed} icon={busy ? SMALL_SPINNER : undefined}>
        {busy ? t("support_request.send.sending") : t("support_request.share.button")}
      </Button>
    );

  return (
    <SupportFrame
      onClose={flow.close}
      busy={busy}
      stepper={flow.stepper}
      left={<BackButton onClick={flow.back} disabled={busy || phase === "shared"} />}
      right={right}
    >
      {busy ? (
        <ShareProgress step={step} percent={percent} />
      ) : phase === "shared" ? (
        <Status icon="solar:danger-triangle-bold" tone="bad" title={t("support_request.share.failed")} />
      ) : phase === "failed" ? (
        <Status
          icon="solar:danger-triangle-bold"
          tone="bad"
          title={t("support_request.share.failed")}
          text={t(`support_request.error.${reason}`, { defaultValue: t("support_request.error.unknown") })}
        />
      ) : (
        <div className="space-y-4">
          {phase === "too_large" && (
            <Status icon="solar:danger-triangle-bold" tone="bad" title={t("support_request.share.too_large")} />
          )}
          <div className="flex items-start gap-4">
            <Icon icon="solar:folder-with-files-bold" className="w-12 h-12 shrink-0 text-amber-300" />
            <div className="min-w-0">
              <p className="font-minecraft text-2xl text-white tracking-wide">{t("support_request.share.title", { name })}</p>
              <p className="mt-1 font-minecraft text-lg text-white/80 tracking-wide">
                {t("support_request.share.text", { profile: profile.name })}
              </p>
            </div>
          </div>

          {personal && (
            <p className="flex items-center gap-1.5 font-minecraft text-sm text-amber-300 tracking-wide">
              <Icon icon="solar:shield-warning-bold" className="w-4 h-4 shrink-0" />
              {t("support_request.share.personal_warning")}
            </p>
          )}

          <TextLink onClick={() => setDetails((d) => !d)}>{t("support_request.share.pro")}</TextLink>
          <div className={details ? undefined : "hidden"}>
            <ExportFileSelector profileId={profile.id} selected={selected} onSelectionChange={setSelected} onLoadingChange={setLoadingFiles} only={only} />
          </div>

          <p className="flex items-center gap-1.5 font-minecraft text-sm text-white/45 tracking-wide">
            <Icon icon="solar:lock-keyhole-bold" className="w-4 h-4 shrink-0" />
            {t("support_request.data.privacy")}
          </p>
        </div>
      )}
    </SupportFrame>
  );
}
