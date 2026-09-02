import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  TwitchLoginPayload,
  TwitchStatus,
} from "../types/twitch";

/** Window event the backend emits while the device code flow runs. */
export const TWITCH_LOGIN_EVENT = "twitch:device_login";

export class TwitchService {
  static async beginDeviceLogin(): Promise<void> {
    await invoke("twitch_begin_device_login");
  }

  static async cancelLogin(): Promise<void> {
    await invoke("twitch_cancel_login");
  }

  static async unlink(): Promise<void> {
    await invoke("twitch_unlink");
  }

  static async getStatus(): Promise<TwitchStatus> {
    return await invoke<TwitchStatus>("twitch_get_status");
  }

  static onLoginEvent(
    handler: (payload: TwitchLoginPayload) => void,
  ): Promise<UnlistenFn> {
    return listen<TwitchLoginPayload>(TWITCH_LOGIN_EVENT, (event) =>
      handler(event.payload),
    );
  }
}
