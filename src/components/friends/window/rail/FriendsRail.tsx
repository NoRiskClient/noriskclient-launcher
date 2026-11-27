import { useTranslation } from "react-i18next";
import type { FriendsFriendUser } from "../../../../store/friends-store";
import { AdCaption, AdFrame, FRIENDS_AD_SLOT, useAdSize } from "../../../ads/AdCard";
import { isOnlineState } from "../status";
import { ProfileSection } from "./ProfileSection";
import { ServerCard, useServerPing } from "./ServerCard";
import { profileSummary } from "./profile-summary";

/** Right rail of an open chat: server, profile and ad. Left out when all are empty. */
export function FriendsRail({ friend }: { friend: FriendsFriendUser }) {
  const { t } = useTranslation();
  const ad = useAdSize(FRIENDS_AD_SLOT);
  const online = isOnlineState(friend.state);
  const server = online ? friend.server : null;
  const ping = useServerPing(server);
  const profile = profileSummary(friend, online, t);

  if (!server && !ad && !profile) return null;

  return (
    <aside className="fw-pane fw-line-l flex w-[326px] shrink-0 flex-col overflow-hidden">
      <div className="fw-scroll min-h-0 flex-1 space-y-5 px-3 pb-4 pt-4">
        {server && (
          <section>
            <p className="fw-label mb-2">{t("friends.profile_now_playing")}</p>
            <ServerCard address={server} ping={ping} />
          </section>
        )}
        {profile && <ProfileSection profile={profile} />}
      </div>
      {ad && (
        <div className="shrink-0 space-y-2 px-3 pb-3">
          <AdFrame slot={FRIENDS_AD_SLOT} size={ad} />
          <AdCaption />
        </div>
      )}
    </aside>
  );
}
