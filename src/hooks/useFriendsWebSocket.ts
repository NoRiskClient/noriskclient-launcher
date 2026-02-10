import { useEffect, useRef } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useFriendsStore, OnlineState } from "../store/friends-store";
import { toast } from "../components/ui/GlobalToaster";

interface FriendOnlinePayload {
  uuid: string;
  username: string;
  state: OnlineState;
  server?: string;
}

interface FriendStateChangedPayload {
  newState: OnlineState;
  user: {
    uuid: string;
    ign: string;
  };
}

interface ChatMessagePayload {
  chatId: string;
  senderId: string;
  content: string;
}

interface ServerChangedPayload {
  noriskUser: {
    uuid: string;
    ign: string;
  };
  server: string | null;
}

interface FriendRequestPayload {
  friendRequest?: {
    sender: string;
    receiver: string;
  };
  users?: Array<{
    uuid: string;
    ign: string;
  }>;
}

export function useFriendsWebSocket() {
  const unlistenersRef = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    const setupListeners = async () => {
      const unlistenConnected = await listen("friends:ws_connected", () => {
        useFriendsStore.getState().setWsConnected(true);
      });

      const unlistenDisconnected = await listen("friends:ws_disconnected", () => {
        useFriendsStore.getState().setWsConnected(false);
      });

      const unlistenOnline = await listen<FriendOnlinePayload>(
        "friends:friend_online",
        (event) => {
          const store = useFriendsStore.getState();
          const friend = store.friends.find(f => f.uuid === event.payload.uuid);
          const username = event.payload.username || friend?.username || "Friend";
          store.updateFriendState(event.payload.uuid, "ONLINE", event.payload.server);
          if (store.notificationsEnabled) {
            toast.player(`${username} is now online`, event.payload.uuid);
          }
        }
      );

      const unlistenOffline = await listen<FriendOnlinePayload>(
        "friends:friend_offline",
        (event) => {
          const store = useFriendsStore.getState();
          const friend = store.friends.find(f => f.uuid === event.payload.uuid);
          const username = event.payload.username || friend?.username || "Friend";
          store.updateFriendState(event.payload.uuid, "OFFLINE", undefined);
          if (store.notificationsEnabled) {
            toast.player(`${username} went offline`, event.payload.uuid);
          }
        }
      );

      const unlistenStateChanged = await listen<FriendStateChangedPayload>(
        "friends:status_changed",
        (event) => {
          useFriendsStore.getState().updateFriendState(event.payload.user.uuid, event.payload.newState, undefined);
        }
      );

      const unlistenServerChanged = await listen<ServerChangedPayload>(
        "friends:server_changed",
        (event) => {
          const uuid = event.payload.noriskUser?.uuid;
          const username = event.payload.noriskUser?.ign;
          const server = event.payload.server;

          if (!uuid) return;

          const store = useFriendsStore.getState();
          const friend = store.friends.find(f => f.uuid === uuid);

          if (friend) {
            store.updateFriendState(uuid, friend.state, server ?? undefined);
          }

          if (server && store.notificationsEnabled) {
            const displayName = username || friend?.username || "Friend";
            toast.player(`${displayName} is now playing on ${server}`, uuid);
          }
        }
      );

      const unlistenRequest = await listen<FriendRequestPayload>(
        "friends:request_received",
        (event) => {
          const store = useFriendsStore.getState();
          store.loadPendingRequests();
          const senderUuid = event.payload.friendRequest?.sender;
          const senderUser = event.payload.users?.find(u => u.uuid === senderUuid);
          if (senderUser && senderUuid !== store.currentUser?.uuid && store.notificationsEnabled) {
            toast.player(`${senderUser.ign} sent you a friend request`, senderUuid);
          }
        }
      );

      const unlistenRequestAccepted = await listen(
        "friends:request_accepted",
        () => {
          const store = useFriendsStore.getState();
          store.loadFriends(true);
          store.loadPendingRequests();
        }
      );

      const unlistenChatMessage = await listen<ChatMessagePayload>(
        "chat:message_received",
        (event) => {
          const store = useFriendsStore.getState();
          const senderId = event.payload.senderId;
          const content = event.payload.content || "New message";

          if (senderId === store.currentUser?.uuid) return;
          if (store.activeChatFriend?.uuid === senderId) return;
          if (!store.notificationsEnabled) return;

          const friend = store.friends.find(f => f.uuid === senderId);
          const senderName = friend?.username || "Someone";
          const preview = content.slice(0, 50) + (content.length > 50 ? "..." : "");

          toast.player(`${senderName}: ${preview}`, senderId);
        }
      );

      unlistenersRef.current = [
        unlistenConnected,
        unlistenDisconnected,
        unlistenOnline,
        unlistenOffline,
        unlistenStateChanged,
        unlistenServerChanged,
        unlistenRequest,
        unlistenRequestAccepted,
        unlistenChatMessage,
      ];
    };

    setupListeners();

    return () => {
      unlistenersRef.current.forEach((unlisten) => unlisten());
      unlistenersRef.current = [];
    };
  }, []);
}
