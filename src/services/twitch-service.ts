import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TwitchLoginPayload } from "../types/twitch";

export const TWITCH_LOGIN_EVENT = "twitch:device_login";

export class TwitchService {
  static async getAvailableScopes(): Promise<string[]> {
    return await invoke<string[]>("twitch_available_scopes");
  }

  static async beginDeviceLogin(scopes: string[]): Promise<void> {
    await invoke("twitch_begin_device_login", { scopes });
  }

  static async cancelLogin(): Promise<void> {
    await invoke("twitch_cancel_login");
  }

  static async unlink(): Promise<void> {
    await invoke("twitch_unlink");
  }

  static async isLinked(): Promise<boolean> {
    return await invoke<boolean>("twitch_is_linked");
  }

  static onLoginEvent(
    handler: (payload: TwitchLoginPayload) => void,
  ): Promise<UnlistenFn> {
    return listen<TwitchLoginPayload>(TWITCH_LOGIN_EVENT, (event) =>
      handler(event.payload),
    );
  }
}
