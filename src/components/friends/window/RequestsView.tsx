import { memo, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useFriendsStore, type FriendRequestWithUsers } from "../../../store/friends-store";
import { toast } from "../../ui/GlobalToaster";
import { translateApiError } from "../../../utils/nrc-error-translations";
import { AddFriendForm } from "./AddFriendForm";
import { PlayerAvatar } from "./PlayerAvatar";
import { ViewHeader } from "./ViewHeader";

interface RequestsViewProps {
  incoming: FriendRequestWithUsers[];
  outgoing: FriendRequestWithUsers[];
}

export function RequestsView({ incoming, outgoing }: RequestsViewProps) {
  const { t } = useTranslation();
  const empty = incoming.length === 0 && outgoing.length === 0;

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <ViewHeader icon="solar:inbox-bold" title={t("friends.requests_title")} />
      <div className="fw-scroll min-h-0 flex-1">
        <div className="mx-auto max-w-[620px] px-6 py-6">
          <div className="fw-label mb-2">{t("friends.add_friend")}</div>
          <AddFriendForm />
          <p className="fw-meta fw-faint mt-2">{t("friends.add_friend_hint")}</p>

          {empty ? (
            <div className="fw-line-t mt-8 flex flex-col items-center pt-10 text-center">
              <span className="fw-icon-tile mb-3">
                <Icon icon="solar:inbox-bold" className="h-6 w-6" />
              </span>
              <p className="fw-name fw-muted">{t("friends.no_requests_title")}</p>
              <p className="fw-meta fw-faint mt-1">{t("friends.no_requests_hint")}</p>
            </div>
          ) : (
            <>
              <RequestSection label={t("friends.incoming")} requests={incoming} type="incoming" />
              <RequestSection label={t("friends.sent")} requests={outgoing} type="outgoing" />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function RequestSection({
  label,
  requests,
  type,
}: {
  label: string;
  requests: FriendRequestWithUsers[];
  type: "incoming" | "outgoing";
}) {
  if (requests.length === 0) return null;
  return (
    <div className="mt-8">
      <div className="fw-line-b flex items-center gap-2 pb-2">
        <span className="fw-label">{label}</span>
        <span className="fw-label fw-num">{requests.length}</span>
      </div>
      <ul>
        {requests.map((r) => (
          <RequestRow key={r.id} request={r} type={type} />
        ))}
      </ul>
    </div>
  );
}

const RequestRow = memo(function RequestRow({
  request,
  type,
}: {
  request: FriendRequestWithUsers;
  type: "incoming" | "outgoing";
}) {
  const { t } = useTranslation();
  const currentUser = useFriendsStore((s) => s.currentUser);
  const acceptRequest = useFriendsStore((s) => s.acceptRequest);
  const denyRequest = useFriendsStore((s) => s.denyRequest);
  const [busy, setBusy] = useState<"accept" | "deny" | null>(null);

  const other = request.users.find((u) => u.uuid.toLowerCase() !== currentUser?.uuid?.toLowerCase());
  if (!other) return null;

  const run = async (kind: "accept" | "deny") => {
    if (busy) return;
    setBusy(kind);
    try {
      if (kind === "accept") {
        await acceptRequest(other.username);
        toast.success(t("friends.now_friends", { name: other.username }));
      } else {
        await denyRequest(other.username);
      }
    } catch (e) {
      toast.error(translateApiError(e));
      setBusy(null);
    }
  };

  return (
    <li className="fw-sep flex items-center gap-3 py-3">
      <PlayerAvatar uuid={other.uuid} name={other.username} size={36} />
      <div className="min-w-0 flex-1">
        <p className="fw-name fw-ink truncate">{other.username}</p>
        <p className="fw-meta fw-faint truncate">
          {type === "incoming" ? t("friends.wants_to_be_friends") : t("friends.request_waiting")}
        </p>
      </div>
      {type === "incoming" ? (
        <div className="flex gap-1.5">
          <button type="button" className="fw-btn fw-btn-ghost" onClick={() => run("deny")} disabled={!!busy}>
            {busy === "deny" ? <Icon icon="svg-spinners:ring-resize" className="h-4 w-4" /> : t("common.deny")}
          </button>
          <button type="button" className="fw-btn fw-btn-primary" onClick={() => run("accept")} disabled={!!busy}>
            {busy === "accept" ? <Icon icon="svg-spinners:ring-resize" className="h-4 w-4" /> : t("common.accept")}
          </button>
        </div>
      ) : (
        <button type="button" className="fw-btn fw-btn-ghost" onClick={() => run("deny")} disabled={!!busy}>
          {busy ? <Icon icon="svg-spinners:ring-resize" className="h-4 w-4" /> : t("friends.cancel_request")}
        </button>
      )}
    </li>
  );
});
