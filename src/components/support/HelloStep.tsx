"use client";

import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { toast } from "react-hot-toast";
import { Button } from "../ui/buttons/Button";
import { useClickGuard } from "../../hooks/useClickGuard";
import { SupportRequestService } from "../../services/support-request-service";
import { SMALL_SPINNER, SupportFrame, SupporterAvatar, TextLink, useAccentStyle, type StepFlow } from "./parts";

const EXPIRES_SOON_MS = 3 * 60 * 60 * 1000;

export function HelloStep({ flow, profilesReady }: { flow: StepFlow; profilesReady: boolean }) {
  const { t } = useTranslation();
  const accentStyle = useAccentStyle();
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [declining, setDeclining] = useState(false);
  const armed = useClickGuard(confirmDecline);
  const { info } = flow;
  const name = info.requestedBy.displayName;
  const msLeft = Date.parse(info.expiresAt) - Date.now();
  const expiresSoon = Number.isFinite(msLeft) && msLeft > 0 && msLeft < EXPIRES_SOON_MS;

  const decline = async () => {
    setDeclining(true);
    try {
      await SupportRequestService.decline(flow.code);
      toast.success(t("support_request.hello.declined"));
      flow.close();
    } catch (e) {
      flow.showError(e);
    } finally {
      setDeclining(false);
    }
  };

  return (
    <SupportFrame
      onClose={flow.close}
      busy={declining}
      stepper={flow.stepper}
      left={
        confirmDecline ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-minecraft text-sm text-white/80 tracking-wide">
              {t("support_request.hello.decline_confirm")}
            </span>
            <Button variant="ghost" size="sm" onClick={decline} disabled={declining || !armed}>
              {declining ? SMALL_SPINNER : t("support_request.hello.decline_yes")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDecline(false)} disabled={declining}>
              {t("support_request.hello.decline_no")}
            </Button>
          </div>
        ) : (
          <TextLink onClick={() => setConfirmDecline(true)}>{t("support_request.hello.decline")}</TextLink>
        )
      }
      right={
        <Button variant="default" size="lg" onClick={flow.next} disabled={!profilesReady || declining || !armed}>
          {t("support_request.hello.start")}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-4">
          <SupporterAvatar info={info} />
          <div className="flex-1 min-w-0 rounded-2xl rounded-tl-sm border-2 p-4" style={accentStyle}>
            <p className="font-minecraft text-2xl text-white tracking-wide">{t("support_request.hello.greeting")}</p>
            <p className="mt-1 font-minecraft text-lg text-white/90 tracking-wide">
              {t("support_request.hello.bubble", { name })}
            </p>
            {info.note && (
              <p className="mt-3 max-h-32 overflow-y-auto custom-scrollbar border-l-4 border-white/30 pl-3 font-minecraft text-base text-white/75 tracking-wide whitespace-pre-wrap break-words">
                {info.note}
              </p>
            )}
          </div>
        </div>
        {expiresSoon && (
          <p className="pl-24 flex items-center gap-1 font-minecraft text-sm text-amber-300 tracking-wide">
            <Icon icon="solar:clock-circle-bold" className="w-4 h-4" />
            {t("support_request.hello.expires_soon")}
          </p>
        )}
      </div>
    </SupportFrame>
  );
}
