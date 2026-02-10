import { useEffect, useState, useMemo } from "react";
import { Icon } from "@iconify/react";
import { useFriendsStore, FriendsFriendUser } from "../../store/friends-store";
import { useThemeStore } from "../../store/useThemeStore";
import { FriendListItem } from "./FriendListItem";
import { FriendRequestItem } from "./FriendRequestItem";
import { FriendSkeleton } from "./FriendSkeleton";
import { AddFriendInput } from "./AddFriendInput";
import { ChatPanel } from "../chat/ChatPanel";
import { SettingsPanel } from "./SettingsPanel";
import { toast } from "../ui/GlobalToaster";
import { cn } from "../../lib/utils";
import { Virtuoso } from "react-virtuoso";

type FriendListRow =
  | { type: "header"; status: "online" | "offline"; count: number }
  | { type: "friend"; friend: FriendsFriendUser };

type TabType = "friends" | "requests";

export function FriendsSidebar() {
  const {
    friends,
    pendingRequests,
    currentUser,
    isLoading,
    isSidebarOpen,
    isSettingsOpen,
    activeChatFriend,
    notificationsEnabled,
    closeSidebar,
    closeChat,
    closeSettings,
    loadFriends,
    loadPendingRequests,
    toggleNotifications,
    openSettings,
  } = useFriendsStore();

  const { accentColor } = useThemeStore();
  const [activeTab, setActiveTab] = useState<TabType>("friends");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (isSidebarOpen) {
      loadFriends();
      loadPendingRequests();
    }
  }, [isSidebarOpen]);

  const handleClose = () => {
    closeChat();
    closeSettings();
    closeSidebar();
  };

  const onlineFriends = useMemo(() =>
    friends.filter((f) => f && ["ONLINE", "AFK", "BUSY"].includes(f.state)),
    [friends]
  );
  const offlineFriends = useMemo(() =>
    friends.filter((f) => f && ["OFFLINE", "INVISIBLE"].includes(f.state)),
    [friends]
  );

  const incomingRequests = useMemo(() =>
    pendingRequests.filter((r) => r.receiver?.toLowerCase() === currentUser?.uuid?.toLowerCase()),
    [pendingRequests, currentUser?.uuid]
  );
  const outgoingRequests = useMemo(() =>
    pendingRequests.filter((r) => r.sender?.toLowerCase() === currentUser?.uuid?.toLowerCase()),
    [pendingRequests, currentUser?.uuid]
  );

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity duration-300",
          isSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={handleClose}
      />

      <div
        className={cn(
          "fixed top-0 right-0 h-full z-50 flex transition-transform duration-300 ease-out",
          isSidebarOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div
          className={cn(
            "h-full flex flex-col transition-all duration-300 ease-out overflow-hidden backdrop-blur-md",
            (activeChatFriend || isSettingsOpen) ? "w-[380px] opacity-100" : "w-0 opacity-0"
          )}
          style={{
            background: `linear-gradient(135deg, ${accentColor.value}40 0%, ${accentColor.value}30 50%, ${accentColor.value}35 100%)`,
            borderLeft: (activeChatFriend || isSettingsOpen) ? `2px solid ${accentColor.value}50` : "none",
            boxShadow: (activeChatFriend || isSettingsOpen) ? `inset 0 0 100px ${accentColor.value}25` : "none",
          }}
        >
          {activeChatFriend && <ChatPanel friend={activeChatFriend} />}
          {isSettingsOpen && !activeChatFriend && <SettingsPanel />}
        </div>

        <div
          className="w-96 h-full flex flex-col backdrop-blur-md"
          style={{
            background: `linear-gradient(180deg, ${accentColor.value}45 0%, ${accentColor.value}35 30%, ${accentColor.value}40 100%)`,
            borderLeft: `2px solid ${accentColor.value}60`,
            boxShadow: `inset 0 0 120px ${accentColor.value}30, -5px 0 20px rgba(0, 0, 0, 0.5)`,
          }}
        >
          <div className="p-4" style={{ borderBottom: `1px solid ${accentColor.value}30` }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={openSettings}
                  className="p-2 rounded-full transition-all duration-200 hover:scale-105"
                  style={{
                    backgroundColor: isSettingsOpen ? `${accentColor.value}40` : `${accentColor.value}20`,
                    border: `1px solid ${isSettingsOpen ? `${accentColor.value}70` : `${accentColor.value}50`}`,
                  }}
                  title="Settings"
                >
                  <Icon icon="solar:settings-bold" className="w-5 h-5" style={{ color: accentColor.value }} />
                </button>
                <h2 className="text-lg font-bold text-white font-minecraft-ten uppercase tracking-wide">
                  Friends
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { loadFriends(true); loadPendingRequests(); }}
                  className="p-2 rounded-full transition-all duration-200 hover:scale-105"
                  style={{ backgroundColor: `${accentColor.value}20`, border: `1px solid ${accentColor.value}50`, color: accentColor.value }}
                  title="Refresh"
                >
                  <Icon icon="solar:refresh-bold" className="w-5 h-5" />
                </button>
                <button
                  onClick={() => {
                    toggleNotifications();
                    toast.info(notificationsEnabled ? "Notifications disabled" : "Notifications enabled");
                  }}
                  className="p-2 rounded-full transition-all duration-200 hover:scale-105"
                  style={{
                    backgroundColor: notificationsEnabled ? `${accentColor.value}20` : "rgba(239, 68, 68, 0.2)",
                    border: `1px solid ${notificationsEnabled ? `${accentColor.value}50` : "rgba(239, 68, 68, 0.5)"}`,
                    color: notificationsEnabled ? accentColor.value : "#ef4444",
                  }}
                  title={notificationsEnabled ? "Disable notifications" : "Enable notifications"}
                >
                  <Icon icon={notificationsEnabled ? "solar:bell-bold" : "solar:bell-off-bold"} className="w-5 h-5" />
                </button>
                <button
                  onClick={handleClose}
                  className="p-2 rounded-full transition-all duration-200 hover:scale-105"
                  style={{ backgroundColor: `${accentColor.value}20`, border: `1px solid ${accentColor.value}50`, color: accentColor.value }}
                  title="Close"
                >
                  <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div
              className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{
                backgroundColor: `${accentColor.value}15`,
                border: `1px solid ${accentColor.value}40`,
              }}
            >
              <Icon icon="solar:magnifer-bold" className="w-5 h-5" style={{ color: `${accentColor.value}80` }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search friends..."
                className="flex-1 bg-transparent text-white text-sm font-minecraft-ten placeholder:text-white/30 focus:outline-none"
              />
            </div>
          </div>

          <div className="p-3" style={{ borderBottom: `1px solid ${accentColor.value}30` }}>
            <div
              className="flex rounded-xl p-1"
              style={{ backgroundColor: `${accentColor.value}15`, border: `1px solid ${accentColor.value}40` }}
            >
              <button
                onClick={() => setActiveTab("friends")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-minecraft-ten transition-all duration-200"
                )}
                style={{
                  backgroundColor: activeTab === "friends" ? `${accentColor.value}40` : "transparent",
                  color: activeTab === "friends" ? "white" : "rgba(255,255,255,0.5)",
                  border: activeTab === "friends" ? `1px solid ${accentColor.value}60` : "1px solid transparent",
                }}
              >
                <Icon icon="solar:users-group-rounded-bold" className="w-4 h-4" />
                Friends
              </button>
              <button
                onClick={() => setActiveTab("requests")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-minecraft-ten transition-all duration-200"
                )}
                style={{
                  backgroundColor: activeTab === "requests" ? `${accentColor.value}40` : "transparent",
                  color: activeTab === "requests" ? "white" : "rgba(255,255,255,0.5)",
                  border: activeTab === "requests" ? `1px solid ${accentColor.value}60` : "1px solid transparent",
                }}
              >
                <Icon icon="solar:letter-bold" className="w-4 h-4" />
                Requests
                {incomingRequests.length > 0 && (
                  <span
                    className="text-xs font-minecraft-ten"
                    style={{ color: accentColor.value }}
                  >
                    {incomingRequests.length > 99 ? "99+" : incomingRequests.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {activeTab === "friends" ? (
              <FriendsTab
                currentUser={currentUser}
                onlineFriends={onlineFriends.filter(f => f.username.toLowerCase().includes(searchQuery.toLowerCase()))}
                offlineFriends={offlineFriends.filter(f => f.username.toLowerCase().includes(searchQuery.toLowerCase()))}
                isLoading={isLoading}
                accentColor={accentColor.value}
              />
            ) : (
              <RequestsTab
                incomingRequests={incomingRequests}
                outgoingRequests={outgoingRequests}
                accentColor={accentColor.value}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function FriendsTab({
  currentUser,
  onlineFriends,
  offlineFriends,
  isLoading,
  accentColor,
}: {
  currentUser: ReturnType<typeof useFriendsStore.getState>["currentUser"];
  onlineFriends: ReturnType<typeof useFriendsStore.getState>["friends"];
  offlineFriends: ReturnType<typeof useFriendsStore.getState>["friends"];
  isLoading: boolean;
  accentColor: string;
}) {
  // Build virtualized list with headers
  const listItems = useMemo<FriendListRow[]>(() => {
    const items: FriendListRow[] = [];

    if (onlineFriends.length > 0) {
      items.push({ type: "header", status: "online", count: onlineFriends.length });
      onlineFriends.forEach((friend) => {
        items.push({ type: "friend", friend });
      });
    }

    if (offlineFriends.length > 0) {
      items.push({ type: "header", status: "offline", count: offlineFriends.length });
      offlineFriends.forEach((friend) => {
        items.push({ type: "friend", friend });
      });
    }

    return items;
  }, [onlineFriends, offlineFriends]);

  if (isLoading) {
    return (
      <div className="p-3 space-y-3">
        {[...Array(5)].map((_, i) => (
          <FriendSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (onlineFriends.length === 0 && offlineFriends.length === 0) {
    return (
      <div className="py-12 text-center">
        <div
          className="w-16 h-16 mx-auto mb-4 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${accentColor}15`, border: `1px solid ${accentColor}40` }}
        >
          <Icon icon="solar:users-group-rounded-bold" className="w-8 h-8" style={{ color: accentColor }} />
        </div>
        <p className="text-white/50 text-xs font-minecraft-ten">No Friends Yet</p>
        <p className="text-white/30 text-xl mt-1 font-minecraft">add some!</p>
      </div>
    );
  }

  return (
    <Virtuoso
      style={{ height: "100%" }}
      data={listItems}
      itemContent={(index, row) => {
        if (row.type === "header") {
          const isOnline = row.status === "online";
          return (
            <div className="flex items-center gap-2 px-4 py-3">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={isOnline ? {
                  backgroundColor: "#22c55e",
                  boxShadow: "0 0 8px rgba(34, 197, 94, 0.6)"
                } : {
                  backgroundColor: "#6b7280"
                }}
              />
              <span className={cn(
                "text-xs font-bold uppercase tracking-wider font-minecraft-ten",
                isOnline ? "text-white/70" : "text-white/40"
              )}>
                {isOnline ? "Online" : "Offline"} — {row.count}
              </span>
            </div>
          );
        }

        return (
          <div className="px-3 pb-2">
            <FriendListItem friend={row.friend} />
          </div>
        );
      }}
    />
  );
}

function RequestsTab({
  incomingRequests,
  outgoingRequests,
  accentColor,
}: {
  incomingRequests: ReturnType<typeof useFriendsStore.getState>["pendingRequests"];
  outgoingRequests: ReturnType<typeof useFriendsStore.getState>["pendingRequests"];
  accentColor: string;
}) {
  return (
    <>
      <div className="p-4 border-b border-white/10">
        <div className="text-xs font-medium text-white/40 mb-3 font-minecraft-ten uppercase tracking-wider">
          Add Friend
        </div>
        <AddFriendInput />
      </div>

      {incomingRequests.length > 0 && (
        <div className="mt-2">
          <div
            className="px-4 py-2.5 text-xs font-medium uppercase tracking-wider font-minecraft-ten flex items-center gap-2"
            style={{ color: "#22c55e" }}
          >
            <Icon icon="solar:inbox-in-bold" className="w-4 h-4" />
            Incoming — {incomingRequests.length}
          </div>
          <div className="px-3 space-y-2 pb-4">
            {incomingRequests.map((r) => (
              <FriendRequestItem key={r.id} request={r} type="incoming" />
            ))}
          </div>
        </div>
      )}

      {outgoingRequests.length > 0 && (
        <div className="mt-3">
          <div
            className="px-4 py-2.5 text-xs font-medium uppercase tracking-wider font-minecraft-ten flex items-center gap-2"
            style={{ color: "rgba(255, 255, 255, 0.5)" }}
          >
            <Icon icon="solar:inbox-out-bold" className="w-4 h-4" />
            Pending — {outgoingRequests.length}
          </div>
          <div className="px-3 space-y-2 pb-4">
            {outgoingRequests.map((r) => (
              <FriendRequestItem key={r.id} request={r} type="outgoing" />
            ))}
          </div>
        </div>
      )}

      {incomingRequests.length === 0 && outgoingRequests.length === 0 && (
        <div className="p-8 text-center">
          <div
            className="w-14 h-14 mx-auto mb-4 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${accentColor}15`, border: `1px solid ${accentColor}40` }}
          >
            <Icon icon="solar:letter-linear" className="w-7 h-7" style={{ color: accentColor }} />
          </div>
          <p className="text-white/50 text-xs font-minecraft-ten">No Pending Requests</p>
          <p className="text-white/30 text-xl mt-1 font-minecraft">add friends above!</p>
        </div>
      )}
    </>
  );
}
