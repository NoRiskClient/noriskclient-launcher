export type TwitchLoginStage =
  | "starting"
  | "awaiting_user"
  | "completed"
  | "cancelled"
  | "failed";

export interface TwitchLoginPayload {
  stage: TwitchLoginStage;
  message: string;
  /** Code the user types on the Twitch activation page. */
  user_code: string | null;
  verification_uri: string | null;
  /** 0..100, share of the code's lifetime already elapsed. */
  progress: number | null;
  /** Seconds left before the device code expires. */
  expires_in: number | null;
  error: string | null;
  encrypted_token: string | null;
}

export interface TwitchStatus {
  linked: boolean;
  expires: string | null;
  scopes: string[];
}

export interface TwitchDeviceLogin {
  user_code: string;
  verification_uri: string;
  expires_in: number;
}
