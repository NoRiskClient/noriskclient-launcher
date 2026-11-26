import { useTranslation } from "react-i18next";
import { useProfileLaunch } from "../../../hooks/useProfileLaunch";
import { ProfileIconV2 } from "../../profiles/ProfileIconV2";
import type { Profile } from "../../../types/profile";
import { useRecentProfiles } from "./useRecentProfiles";
import { WidgetMessage, WidgetRow } from "./WidgetParts";

const VISIBLE_PROFILES = 5;

export function ContinueWidget() {
  const { t } = useTranslation();
  const recent = useRecentProfiles(VISIBLE_PROFILES);
  if (recent.length === 0) return <WidgetMessage icon="solar:play-bold" text={t("rail_widgets.no_profile")} />;
  return (
    <div className="flex flex-col gap-0.5">
      {recent.map((profile) => (
        <ContinueRow key={profile.id} profile={profile} />
      ))}
    </div>
  );
}

function ContinueRow({ profile }: { profile: Profile }) {
  const { t } = useTranslation();
  const { isLaunching, statusMessage, handleLaunch } = useProfileLaunch({ profileId: profile.id });
  return (
    <WidgetRow
      media={<ProfileIconV2 profile={profile} size="sm" className="w-full h-full" />}
      title={profile.name}
      subtitle={isLaunching ? statusMessage || t("profiles.card.starting") : `${profile.game_version} · ${profile.loader}`}
      launchable
      launching={isLaunching}
      onClick={() => void handleLaunch()}
    />
  );
}
