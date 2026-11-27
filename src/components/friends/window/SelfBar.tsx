import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useFriendsStore, type OnlineState } from "../../../store/friends-store";
import { toast } from "../../ui/GlobalToaster";
import { translateApiError } from "../../../utils/nrc-error-translations";
import { PlayerAvatar } from "./PlayerAvatar";
import { Popover } from "./Popover";
import { SELECTABLE_STATUSES, statusMeta } from "./status";

export function SelfBar() {
  const { t } = useTranslation();
  const currentUser = useFriendsStore((s) => s.currentUser);
  const activeView = useFriendsStore((s) => s.activeView);
  const openView = useFriendsStore((s) => s.openView);
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="fw-line-t flex items-center gap-1 p-2">
      <button
        ref={anchorRef}
        type="button"
        className="fw-row min-h-0 flex-1"
        data-active={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        disabled={!currentUser}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <PlayerAvatar
          uuid={currentUser?.uuid}
          name={currentUser?.username}
          size={32}
          status={currentUser?.state}
          self
        />
        <span className="min-w-0 flex-1">
          <span className="fw-name fw-ink block truncate">{currentUser?.username ?? t("common.loading")}</span>
          {currentUser && (
            <span className="fw-meta fw-faint block truncate">{t(statusMeta(currentUser.state, true).labelKey)}</span>
          )}
        </span>
        <Icon icon="solar:sort-vertical-linear" className="fw-faint h-3.5 w-3.5 shrink-0" />
      </button>
      <button
        type="button"
        className="fw-icon-btn"
        data-active={activeView === "settings"}
        onClick={() => openView("settings")}
        title={t("common.settings")}
        aria-label={t("common.settings")}
      >
        <Icon icon="solar:settings-bold" className="h-4 w-4" />
      </button>

      <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={anchorRef} width={220} side="top">
        <div className="fw-label px-2.5 pb-1 pt-1.5">{t("friends.settings.status")}</div>
        {currentUser && <StatusOptions current={currentUser.state} onPicked={() => setMenuOpen(false)} />}
      </Popover>
    </div>
  );
}

export function StatusOptions({ current, onPicked }: { current: OnlineState; onPicked?: () => void }) {
  const { t } = useTranslation();
  const setStatus = useFriendsStore((s) => s.setStatus);
  const [pending, setPending] = useState<OnlineState | null>(null);

  const pick = async (state: OnlineState) => {
    if (state === current || pending) {
      onPicked?.();
      return;
    }
    setPending(state);
    try {
      await setStatus(state);
      onPicked?.();
    } catch (e) {
      toast.error(translateApiError(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div role="menu">
      {SELECTABLE_STATUSES.map((state) => (
        <button
          key={state}
          type="button"
          role="menuitemradio"
          aria-checked={state === current}
          className="fw-menu-item"
          data-active={state === current}
          onClick={() => pick(state)}
        >
          <span className="fw-dot" style={{ backgroundColor: statusMeta(state, true).color }} />
          <span className="flex-1">{t(statusMeta(state, true).labelKey)}</span>
          {pending === state ? (
            <Icon icon="svg-spinners:ring-resize" className="h-3.5 w-3.5" />
          ) : (
            state === current && <Icon icon="solar:check-circle-linear" className="fw-accent h-3.5 w-3.5" />
          )}
        </button>
      ))}
    </div>
  );
}
