import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useFriendsStore } from "../../../store/friends-store";
import { useChatStore } from "../../../store/chat-store";
import { THEME_STORAGE_KEY, useThemeStore } from "../../../store/useThemeStore";
import { useFontStore } from "../../../store/font-store";
import { useMinecraftAuthStore } from "../../../store/minecraft-auth-store";
import { FriendsTitlebar } from "./FriendsTitlebar";
import { CountBadge } from "./CountBadge";
import { FriendsListPane } from "./FriendsListPane";
import { ChatView } from "./chat/ChatView";
import { RequestsView } from "./RequestsView";
import { SettingsView } from "./SettingsView";
import { FriendsRail } from "./rail/FriendsRail";
import { useRailFits } from "./rail/useRailFits";
import { useLauncherAdsStore } from "../../../store/launcher-ads-store";
import "./friends-window.css";

/** The friends socket is disabled, so lists refresh on an interval and on focus. */
const LIST_POLL_MS = 30_000;
const MIN_REFRESH_GAP_MS = 3_000;

export function FriendsWindow() {
  const activeView = useFriendsStore((s) => s.activeView);
  const activeChatFriend = useFriendsStore((s) => s.activeChatFriend);
  const pendingRequests = useFriendsStore((s) => s.pendingRequests);
  const currentUser = useFriendsStore((s) => s.currentUser);
  const error = useFriendsStore((s) => s.error);
  const hasLoadedFriends = useFriendsStore((s) => s.hasLoadedFriends);
  const [refreshing, setRefreshing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const railFits = useRailFits();

  // Background refreshes are silent and skipped right after another one.
  const lastRefreshAt = useRef(0);
  const refreshAll = useCallback(async ({ force = true, manual = false } = {}) => {
    const now = Date.now();
    if (!manual && now - lastRefreshAt.current < MIN_REFRESH_GAP_MS) return;
    lastRefreshAt.current = now;
    const friends = useFriendsStore.getState();
    if (manual) setRefreshing(true);
    try {
      await friends.loadCurrentUser();
      await Promise.all([
        friends.loadFriends(force),
        friends.loadPendingRequests(),
        useChatStore.getState().loadChats(),
      ]);
    } finally {
      if (manual) setRefreshing(false);
    }
  }, []);

  // Launcher theme, kept in sync while open.
  useEffect(() => {
    const theme = useThemeStore.getState();
    theme.applyAccentColorToDOM();
    theme.applyBorderRadiusToDOM();
    useFontStore.getState().applyFontToDOM();
    void useMinecraftAuthStore.getState().initializeAccounts();
    void useLauncherAdsStore.getState().refresh();

    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) void useThemeStore.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    void refreshAll();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshAll();
    }, LIST_POLL_MS);
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) void refreshAll({ force: false });
    });
    return () => {
      window.clearInterval(id);
      void unlisten.then((fn) => fn());
    };
  }, [refreshAll]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { incoming, outgoing } = useMemo(() => {
    const me = currentUser?.uuid?.toLowerCase();
    return {
      incoming: pendingRequests.filter((r) => r.receiver?.toLowerCase() === me),
      outgoing: pendingRequests.filter((r) => r.sender?.toLowerCase() === me),
    };
  }, [pendingRequests, currentUser?.uuid]);

  const unavailable = !currentUser && !!error && !refreshing;

  return (
    <div className="fw-root flex h-screen flex-col overflow-hidden">
      <FriendsTitlebar onRefresh={() => void refreshAll({ manual: true })} refreshing={refreshing} />

      {unavailable ? (
        <Unavailable message={error} onRetry={() => void refreshAll({ manual: true })} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <FriendsListPane ref={searchRef} incomingCount={incoming.length} />
          <main className="flex min-w-0 flex-1">
            {activeView === "chat" && activeChatFriend ? (
              <ChatView key={activeChatFriend.uuid} friend={activeChatFriend} />
            ) : activeView === "requests" ? (
              <RequestsView incoming={incoming} outgoing={outgoing} />
            ) : activeView === "settings" ? (
              <SettingsView />
            ) : (
              <Welcome incomingCount={incoming.length} ready={hasLoadedFriends} />
            )}
          </main>
          {railFits && activeView === "chat" && activeChatFriend && <FriendsRail friend={activeChatFriend} />}
        </div>
      )}
    </div>
  );
}

function Welcome({ incomingCount, ready }: { incomingCount: number; ready: boolean }) {
  const { t } = useTranslation();
  const openView = useFriendsStore((s) => s.openView);

  return (
    <div className="m-auto flex max-w-sm flex-col items-center px-6 text-center">
      <p className="fw-name-lg fw-muted">{t("friends.welcome_title")}</p>
      <p className="fw-meta fw-faint mt-1.5">{t("friends.welcome_body")}</p>
      {ready && incomingCount > 0 && (
        <button type="button" className="fw-btn fw-btn-ghost mt-5" onClick={() => openView("requests")}>
          <Icon icon="solar:inbox-bold" className="h-3.5 w-3.5" />
          {t("friends.view_requests")}
          <CountBadge count={incomingCount} />
        </button>
      )}
    </div>
  );
}

function Unavailable({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="m-auto flex max-w-sm flex-col items-center px-6 text-center">
      <span className="fw-icon-tile mb-4">
        <Icon icon="solar:cloud-cross-bold" className="h-6 w-6" />
      </span>
      <p className="fw-name-lg fw-ink">{t("friends.unavailable_title")}</p>
      <p className="fw-meta fw-faint mt-1.5">{t("friends.unavailable_body")}</p>
      {message && <p className="fw-meta fw-faint mt-3 break-words opacity-70">{message}</p>}
      <button type="button" className="fw-btn fw-btn-ghost mt-5" onClick={onRetry}>
        {t("common.try_again")}
      </button>
    </div>
  );
}
