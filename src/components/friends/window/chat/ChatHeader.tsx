import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useFriendsStore, type FriendsFriendUser } from "../../../../store/friends-store";
import { toast } from "../../../ui/GlobalToaster";
import { translateApiError } from "../../../../utils/nrc-error-translations";
import { PlayerAvatar } from "../PlayerAvatar";
import { Popover } from "../Popover";
import { isOnlineState, statusMeta } from "../status";

export function ChatHeader({ friend }: { friend: FriendsFriendUser }) {
  const { t } = useTranslation();
  const togglePing = useFriendsStore((s) => s.togglePing);
  const removeFriend = useFriendsStore((s) => s.removeFriend);
  const [pinging, setPinging] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const removeRef = useRef<HTMLButtonElement>(null);
  const online = isOnlineState(friend.state);
  const status = statusMeta(friend.state);

  const onTogglePing = async () => {
    setPinging(true);
    try {
      const enabled = await togglePing(friend.username);
      toast.info(enabled ? t("friends.ping_on", { name: friend.username }) : t("friends.ping_off", { name: friend.username }));
    } catch (e) {
      toast.error(translateApiError(e));
    } finally {
      setPinging(false);
    }
  };

  const onRemove = async () => {
    setRemoving(true);
    try {
      await removeFriend(friend.username, friend.uuid);
      toast.success(t("friends.removed", { name: friend.username }));
    } catch (e) {
      toast.error(translateApiError(e));
      setRemoving(false);
    }
  };

  return (
    <header className="fw-line-b flex h-14 shrink-0 items-center gap-3 px-5">
      <PlayerAvatar
        uuid={friend.uuid}
        name={friend.username}
        size={32}
        status={friend.state}
        ringColor="var(--fw-bg)"
      />
      <div className="min-w-0 flex-1">
        <h2 className="fw-name-lg fw-ink truncate">{friend.username}</h2>
        <p className="fw-meta fw-faint flex items-center gap-1.5 truncate">
          <span>{t(status.labelKey)}</span>
          {online && friend.server && (
            <>
              <span aria-hidden>·</span>
              <span className="fw-muted truncate">{t("friends.playing_on", { server: friend.server })}</span>
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          className="fw-icon-btn"
          data-active={!!friend.pingEnabled}
          onClick={onTogglePing}
          disabled={pinging}
          title={friend.pingEnabled ? t("friends.ping_disable") : t("friends.ping_enable")}
          aria-label={friend.pingEnabled ? t("friends.ping_disable") : t("friends.ping_enable")}
          aria-pressed={!!friend.pingEnabled}
        >
          <Icon icon={friend.pingEnabled ? "solar:bell-bing-bold" : "solar:bell-linear"} className="h-4 w-4" />
        </button>
        <button
          ref={removeRef}
          type="button"
          className="fw-icon-btn"
          data-active={confirmOpen}
          onClick={() => setConfirmOpen((v) => !v)}
          title={t("friends.remove_friend")}
          aria-label={t("friends.remove_friend")}
        >
          <Icon icon="solar:user-minus-bold" className="h-4 w-4" />
        </button>
      </div>

      <Popover open={confirmOpen} onClose={() => setConfirmOpen(false)} anchorRef={removeRef} width={260} align="end">
        <div className="p-2.5">
          <p className="fw-name fw-ink">{t("friends.remove_title", { name: friend.username })}</p>
          <p className="fw-meta fw-faint mt-1">{t("friends.remove_body")}</p>
          <div className="mt-3 flex justify-end gap-1.5">
            <button type="button" className="fw-btn fw-btn-ghost" onClick={() => setConfirmOpen(false)}>
              {t("common.cancel")}
            </button>
            <button type="button" className="fw-btn fw-btn-danger" onClick={onRemove} disabled={removing}>
              {removing ? <Icon icon="svg-spinners:ring-resize" className="h-4 w-4" /> : t("friends.remove_action")}
            </button>
          </div>
        </div>
      </Popover>
    </header>
  );
}
