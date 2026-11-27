import { invoke } from "@tauri-apps/api/core";

/** Opens the friends window, or brings it to the front. */
export const openFriendsWindow = (): Promise<void> => invoke("open_friends_window");
