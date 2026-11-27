import { useTranslation } from "react-i18next";
import { useFriendsStore, type FriendsFriendUser, type OnlineState } from "../../../store/friends-store";
import { usePlayerAvatar } from "../../../hooks/usePlayerAvatar";
import { openFriendsWindow } from "../../../services/friends-window-service";
import { translateApiError } from "../../../utils/nrc-error-translations";
import { toast } from "../../ui/GlobalToaster";
import { PixelImage, StatusDot, WidgetMessage, WidgetRow } from "./WidgetParts";

const STATE_COLOR: Partial<Record<OnlineState, string>> = {
  ONLINE: "#22c55e",
  AFK: "#eab308",
  BUSY: "#ef4444",
};

const isVisible = (friend: FriendsFriendUser) => friend.state !== "OFFLINE" && friend.state !== "INVISIBLE";

export function FriendsWidget() {
  const { t } = useTranslation();
  const friends = useFriendsStore((state) => state.friends);
  const online = friends.filter(isVisible);
  if (online.length === 0) return <WidgetMessage icon="solar:users-group-rounded-bold" text={t("rail_widgets.friends.empty")} />;
  return (
    <div className="flex flex-col gap-0.5">
      {online.map((friend) => (
        <FriendRow key={friend.uuid} friend={friend} onClick={onOpenFriends} />
      ))}
    </div>
  );
}

function onOpenFriends() {
  openFriendsWindow().catch((e) => toast.error(translateApiError(e)));
}

function FriendRow({ friend, onClick }: { friend: FriendsFriendUser; onClick: () => void }) {
  const { t } = useTranslation();
  const avatar = usePlayerAvatar({ uuid: friend.uuid, size: 32 });
  return (
    <WidgetRow
      media={
        <>
          {avatar && <PixelImage src={avatar} />}
          <StatusDot className="absolute bottom-0 right-0 w-2.5 h-2.5" color={STATE_COLOR[friend.state] ?? "#888"} />
        </>
      }
      title={friend.username}
      subtitle={friend.server ?? t(`friends.status.${friend.state.toLowerCase()}`)}
      onClick={onClick}
    />
  );
}
