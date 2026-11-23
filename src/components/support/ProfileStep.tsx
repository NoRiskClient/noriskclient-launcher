import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/buttons/Button";
import { BackButton, SupportFrame, type StepFlow } from "./parts";
import type { SupportProfiles } from "./useSupportProfiles";
import { ProfilePickerGrid } from "../profiles/ProfilePickerGrid";

export function ProfileStep({
  flow,
  profiles,
  locked,
}: {
  flow: StepFlow;
  profiles: SupportProfiles;
  locked: boolean;
}) {
  const { t } = useTranslation();
  const { sorted, profileId, setProfileId, lastPlayedProfileId } = profiles;

  return (
    <SupportFrame
      onClose={flow.close}
      stepper={flow.stepper}
      left={<BackButton onClick={flow.back} />}
      right={
        <Button variant="default" size="lg" onClick={flow.next} disabled={!profileId}>
          {t("support_request.next")}
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="font-minecraft text-xl text-white tracking-wide">{t("support_request.profile.question")}</p>
        <ProfilePickerGrid
          profiles={sorted}
          lastPlayedProfileId={lastPlayedProfileId}
          selectedId={profileId}
          onSelect={(p) => setProfileId(p.id)}
          disabled={locked}
          listClassName="max-h-[300px]"
          renderAction={(p) =>
            p.id === profileId ? <Icon icon="solar:check-circle-bold" className="w-6 h-6 shrink-0 text-green-400" /> : null
          }
        />
        {locked && (
          <p className="font-minecraft text-sm text-white/50 tracking-wide">{t("support_request.profile.locked")}</p>
        )}
      </div>
    </SupportFrame>
  );
}
